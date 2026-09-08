import fs from 'node:fs';
import path from 'node:path';

const METRICS_REL_DIR = path.join('governance', 'metrics');
const INBOX_RECEIPTS_REL_DIR = path.join('governance', 'run-receipts', 'inbox-processing');
const METRIC_NAME = 'processed_inbox_items';

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function dateOnly(date) {
  return date.toISOString().slice(0, 10);
}

function monthOnly(date) {
  return date.toISOString().slice(0, 7);
}

function dateFromDateText(dateText) {
  return new Date(`${dateText}T00:00:00.000Z`);
}

function addUtcDays(date, days) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function startOfUtcDay(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function startOfIsoWeek(date) {
  const day = startOfUtcDay(date);
  const utcDay = day.getUTCDay();
  const daysFromMonday = (utcDay + 6) % 7;
  return addUtcDays(day, -daysFromMonday);
}

function endOfIsoWeek(date) {
  return addUtcDays(startOfIsoWeek(date), 6);
}

function startOfMonth(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function endOfMonth(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
}

function readJsonIfExists(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return fallback;
    throw err;
  }
}

function writeJson(file, data) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function sortBy(key) {
  return (a, b) => String(a[key]).localeCompare(String(b[key]));
}

function trimRecords(records, limit) {
  return records.slice(Math.max(0, records.length - limit));
}

function toPortablePath(processedPath) {
  return processedPath.split(path.sep).join('/');
}

function canonicalizeProcessedPath(instanceRoot, processedPath) {
  const text = String(processedPath || '').trim();
  if (!text) return '';

  if (path.isAbsolute(text)) {
    return toPortablePath(path.normalize(path.relative(instanceRoot, text)));
  }

  return toPortablePath(path.normalize(text));
}

function normalizeProcessedItems(processedItems, instanceRoot) {
  const normalized = new Map();
  for (const item of processedItems || []) {
    const value = typeof item === 'string' ? { path: item } : (item || {});
    const sourceId = String(value.source_id || value.sourceId || '').trim();
    const processedPath = canonicalizeProcessedPath(instanceRoot, value.path || value.current_path || value.original_path);
    const key = sourceId || processedPath;
    if (!key || normalized.has(key)) continue;
    normalized.set(key, {
      key,
      source_id: sourceId || null,
      path: processedPath || null
    });
  }
  return [...normalized.values()];
}

function normalizeProcessedPaths(processedPaths, instanceRoot) {
  return normalizeProcessedItems(processedPaths, instanceRoot).map((item) => item.key);
}

function emptyDaily(updatedAt) {
  return {
    schema_version: 1,
    metric: METRIC_NAME,
    retention: {
      unit: 'day',
      limit: 100
    },
    updated_at: updatedAt,
    records: []
  };
}

function emptyWeekly(updatedAt) {
  return {
    schema_version: 1,
    metric: METRIC_NAME,
    retention: {
      unit: 'week',
      limit: 52
    },
    week_start_day: 'monday',
    updated_at: updatedAt,
    records: []
  };
}

function emptyMonthly(updatedAt) {
  return {
    schema_version: 1,
    metric: METRIC_NAME,
    retention: {
      unit: 'month',
      limit: 24
    },
    updated_at: updatedAt,
    records: []
  };
}

function emptySeenToday(now) {
  return {
    schema_version: 1,
    date: dateOnly(now),
    updated_at: now.toISOString(),
    seen: []
  };
}

export function getMetricsPaths(instanceRoot) {
  const metricsDir = path.join(instanceRoot, METRICS_REL_DIR);
  return {
    metricsDir,
    metricsRelDir: METRICS_REL_DIR,
    dailyPath: path.join(metricsDir, 'daily.json'),
    weeklyPath: path.join(metricsDir, 'weekly.json'),
    monthlyPath: path.join(metricsDir, 'monthly.json'),
    seenTodayPath: path.join(metricsDir, 'seen-today.json')
  };
}

export function getInboxReceiptMetricsPath(instanceRoot) {
  return path.join(instanceRoot, INBOX_RECEIPTS_REL_DIR);
}

export function createStarterMetricsFiles(instanceRoot, options = {}) {
  const now = options.now || new Date();
  const paths = getMetricsPaths(instanceRoot);
  ensureDir(paths.metricsDir);

  if (!fs.existsSync(paths.dailyPath)) writeJson(paths.dailyPath, emptyDaily(now.toISOString()));
  if (!fs.existsSync(paths.weeklyPath)) writeJson(paths.weeklyPath, emptyWeekly(now.toISOString()));
  if (!fs.existsSync(paths.monthlyPath)) writeJson(paths.monthlyPath, emptyMonthly(now.toISOString()));
  if (!fs.existsSync(paths.seenTodayPath)) writeJson(paths.seenTodayPath, emptySeenToday(now));

  return paths;
}

function upsertDaily(daily, today, increment, updatedAt) {
  const records = [...(daily.records || [])].sort(sortBy('date'));
  const existing = records.find((record) => record.date === today);

  if (existing) {
    existing.count = Number(existing.count || 0) + increment;
  } else {
    records.push({ date: today, count: increment });
  }

  return {
    ...daily,
    schema_version: 1,
    metric: METRIC_NAME,
    retention: { unit: 'day', limit: 100 },
    updated_at: updatedAt,
    records: trimRecords(records.sort(sortBy('date')), 100)
  };
}

function refreshCurrentWeek(weekly, daily, now, updatedAt) {
  const weekStart = startOfIsoWeek(now);
  const weekEnd = endOfIsoWeek(now);
  const weekStartText = dateOnly(weekStart);
  const weekEndText = dateOnly(weekEnd);
  const count = (daily.records || [])
    .filter((record) => record.date >= weekStartText && record.date <= weekEndText)
    .reduce((total, record) => total + Number(record.count || 0), 0);

  const records = (weekly.records || [])
    .filter((record) => record.week_start !== weekStartText);
  records.push({ week_start: weekStartText, week_end: weekEndText, count });

  return {
    ...weekly,
    schema_version: 1,
    metric: METRIC_NAME,
    retention: { unit: 'week', limit: 52 },
    week_start_day: 'monday',
    updated_at: updatedAt,
    records: trimRecords(records.sort(sortBy('week_start')), 52)
  };
}

function refreshCurrentMonth(monthly, daily, now, updatedAt) {
  const month = monthOnly(now);
  const monthStartText = dateOnly(startOfMonth(now));
  const monthEndText = dateOnly(endOfMonth(now));
  const count = (daily.records || [])
    .filter((record) => record.date >= monthStartText && record.date <= monthEndText)
    .reduce((total, record) => total + Number(record.count || 0), 0);

  const records = (monthly.records || [])
    .filter((record) => record.month !== month);
  records.push({ month, month_start: monthStartText, month_end: monthEndText, count });

  return {
    ...monthly,
    schema_version: 1,
    metric: METRIC_NAME,
    retention: { unit: 'month', limit: 24 },
    updated_at: updatedAt,
    records: trimRecords(records.sort(sortBy('month')), 24)
  };
}

function buildWeeklyFromDailyRecords(dailyRecords, updatedAt) {
  const weeks = new Map();

  for (const record of dailyRecords) {
    const date = dateFromDateText(record.date);
    const weekStart = startOfIsoWeek(date);
    const weekStartText = dateOnly(weekStart);
    const weekEndText = dateOnly(endOfIsoWeek(date));
    const current = weeks.get(weekStartText) || {
      week_start: weekStartText,
      week_end: weekEndText,
      count: 0
    };
    current.count += Number(record.count || 0);
    weeks.set(weekStartText, current);
  }

  return {
    ...emptyWeekly(updatedAt),
    records: trimRecords([...weeks.values()].sort(sortBy('week_start')), 52)
  };
}

function buildMonthlyFromDailyRecords(dailyRecords, updatedAt) {
  const months = new Map();

  for (const record of dailyRecords) {
    const date = dateFromDateText(record.date);
    const month = monthOnly(date);
    const current = months.get(month) || {
      month,
      month_start: dateOnly(startOfMonth(date)),
      month_end: dateOnly(endOfMonth(date)),
      count: 0
    };
    current.count += Number(record.count || 0);
    months.set(month, current);
  }

  return {
    ...emptyMonthly(updatedAt),
    records: trimRecords([...months.values()].sort(sortBy('month')), 24)
  };
}

export function recordProcessedInboxItems(instanceRoot, processedPaths, options = {}) {
  const now = options.now || new Date();
  const updatedAt = now.toISOString();
  const today = dateOnly(now);
  const paths = createStarterMetricsFiles(instanceRoot, { now });
  const normalizedItems = normalizeProcessedItems(processedPaths, instanceRoot);

  let seenToday = readJsonIfExists(paths.seenTodayPath, emptySeenToday(now));
  if (seenToday.date !== today) {
    seenToday = emptySeenToday(now);
  }

  const seenKeys = new Set((seenToday.seen || []).map((entry) => entry.key));
  const newItems = normalizedItems.filter((item) => !seenKeys.has(item.key));
  const skipped = normalizedItems.length - newItems.length;

  for (const item of newItems) {
    seenToday.seen.push({
      key: item.key,
      source_id: item.source_id,
      path: item.path,
      first_seen_at: updatedAt
    });
  }

  seenToday.updated_at = updatedAt;
  writeJson(paths.seenTodayPath, seenToday);

  let daily = readJsonIfExists(paths.dailyPath, emptyDaily(updatedAt));
  let weekly = readJsonIfExists(paths.weeklyPath, emptyWeekly(updatedAt));
  let monthly = readJsonIfExists(paths.monthlyPath, emptyMonthly(updatedAt));

  if (newItems.length > 0) {
    daily = upsertDaily(daily, today, newItems.length, updatedAt);
  } else {
    daily = {
      ...daily,
      schema_version: 1,
      metric: METRIC_NAME,
      retention: { unit: 'day', limit: 100 },
      updated_at: updatedAt,
      records: trimRecords([...(daily.records || [])].sort(sortBy('date')), 100)
    };
  }

  weekly = refreshCurrentWeek(weekly, daily, now, updatedAt);
  monthly = refreshCurrentMonth(monthly, daily, now, updatedAt);

  writeJson(paths.dailyPath, daily);
  writeJson(paths.weeklyPath, weekly);
  writeJson(paths.monthlyPath, monthly);

  return {
    ok: true,
    counted: newItems.length,
    skipped,
    processed: normalizedItems.length
  };
}

export function backfillProcessedInboxMetrics(instanceRoot, options = {}) {
  const now = options.now || new Date();
  const updatedAt = now.toISOString();
  const receiptsDir = getInboxReceiptMetricsPath(instanceRoot);
  const dailySets = new Map();
  const result = {
    ok: true,
    receipts_scanned: 0,
    receipts_counted: 0,
    receipts_skipped: 0,
    processed_paths_counted: 0
  };

  let receiptFiles = [];
  try {
    receiptFiles = fs.readdirSync(receiptsDir)
      .filter((file) => file.endsWith('.json'))
      .sort();
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }

  for (const receiptFile of receiptFiles) {
    result.receipts_scanned += 1;

    let receipt;
    try {
      receipt = JSON.parse(fs.readFileSync(path.join(receiptsDir, receiptFile), 'utf8'));
    } catch {
      result.receipts_skipped += 1;
      continue;
    }

    const processed = normalizeProcessedItems(
      receipt.source_references?.length ? receipt.source_references : receipt.processed,
      instanceRoot
    );
    const completedAt = receipt.completed_at ? new Date(receipt.completed_at) : null;

    if (!processed.length || !completedAt || Number.isNaN(completedAt.getTime())) {
      result.receipts_skipped += 1;
      continue;
    }

    const day = dateOnly(completedAt);
    const seenForDay = dailySets.get(day) || new Set();
    const beforeSize = seenForDay.size;

    for (const item of processed) {
      seenForDay.add(item.key);
    }

    dailySets.set(day, seenForDay);

    const counted = seenForDay.size - beforeSize;
    if (counted > 0) {
      result.receipts_counted += 1;
      result.processed_paths_counted += counted;
    } else {
      result.receipts_skipped += 1;
    }
  }

  const dailyRecords = [...dailySets.entries()]
    .map(([date, seen]) => ({ date, count: seen.size }))
    .sort(sortBy('date'));
  const daily = {
    ...emptyDaily(updatedAt),
    records: trimRecords(dailyRecords, 100)
  };
  const weekly = buildWeeklyFromDailyRecords(dailyRecords, updatedAt);
  const monthly = buildMonthlyFromDailyRecords(dailyRecords, updatedAt);
  const paths = createStarterMetricsFiles(instanceRoot, { now });

  writeJson(paths.dailyPath, daily);
  writeJson(paths.weeklyPath, weekly);
  writeJson(paths.monthlyPath, monthly);

  const todaysSeen = dailySets.get(dateOnly(now)) || new Set();
  writeJson(paths.seenTodayPath, {
    schema_version: 1,
    date: dateOnly(now),
    updated_at: updatedAt,
    seen: [...todaysSeen].sort().map((key) => ({
      key,
      first_seen_at: updatedAt
    }))
  });

  return result;
}
