import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { formatUtcTimestamp, resolveCapturedBy } from './capture.mjs';

const SCHEMA_VERSION = 2;
const DEFAULT_LEASE_MS = 24 * 60 * 60 * 1000;
const LOCK_REL_PATH = path.join('governance', 'inbox-processing.lock.json');
const RECEIPTS_REL_DIR = path.join('governance', 'run-receipts', 'inbox-processing');
const OVERRIDES_REL_DIR = path.join(RECEIPTS_REL_DIR, 'overrides');
const RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const MUTATION_MUTEX_PREFIX = 'mole-inbox-processing-';

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function toPortablePath(value) {
  return String(value).split(path.sep).join('/');
}

function relativePath(instanceRoot, absolutePath) {
  return toPortablePath(path.relative(path.resolve(instanceRoot), absolutePath));
}

function readJsonIfExists(file) {
  try {
    return {
      exists: true,
      value: JSON.parse(fs.readFileSync(file, 'utf8')),
      error: null
    };
  } catch (err) {
    if (err.code === 'ENOENT') return { exists: false, value: null, error: null };
    return { exists: true, value: null, error: err };
  }
}

function writeJsonExclusive(file, data) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', {
    encoding: 'utf8',
    flag: 'wx'
  });
}

function writeJsonAtomic(file, data) {
  ensureDir(path.dirname(file));
  const temporary = file + '.' + process.pid + '.' + randomBytes(5).toString('hex') + '.tmp';
  try {
    fs.writeFileSync(temporary, JSON.stringify(data, null, 2) + '\n', {
      encoding: 'utf8',
      flag: 'wx'
    });
    fs.renameSync(temporary, file);
  } catch (err) {
    try {
      fs.unlinkSync(temporary);
    } catch {
      // Preserve the original failure. Temporary metadata is safe to inspect later.
    }
    throw err;
  }
}

function asDate(value, fallback, label) {
  const date = value === undefined || value === null ? fallback : new Date(value);
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new Error('Invalid ' + label + '.');
  }
  return date;
}

function asLeaseMs(options = {}) {
  const value = options.leaseMs ?? options.leaseDurationMs ?? DEFAULT_LEASE_MS;
  const leaseMs = Number(value);
  if (!Number.isFinite(leaseMs) || leaseMs <= 0) {
    throw new Error('Lease duration must be a positive number of milliseconds.');
  }
  return Math.floor(leaseMs);
}

function createRunId() {
  return 'run-' + formatUtcTimestamp(new Date()) + '-' + randomBytes(6).toString('hex');
}

function normalizeRunId(value) {
  const runId = String(value || '').trim();
  return runId || createRunId();
}

function getRequestedRunId(options = {}) {
  return String(options.runId || options.lockId || '').trim();
}

function isValidRunId(runId) {
  return RUN_ID_PATTERN.test(String(runId || '').trim());
}

function resolveProcessor(options = {}, explicitKey = 'processor') {
  return resolveCapturedBy(
    options[explicitKey] || options.claimedBy || options.actor || options.overrideBy
  );
}

function resolveHost(options = {}) {
  return String(options.host || process.env.MOLE_HOST || os.hostname() || 'unknown').trim() || 'unknown';
}

function canonicalizeInboxPath(instanceRoot, value) {
  const text = String(value || '').trim();
  if (!text) return '';
  const root = path.resolve(instanceRoot);
  const absolute = path.isAbsolute(text) ? path.normalize(text) : path.resolve(root, text);
  return toPortablePath(path.relative(root, absolute));
}

function normalizePathList(instanceRoot, values = []) {
  return [...new Set((Array.isArray(values) ? values : [values])
    .map((value) => canonicalizeInboxPath(instanceRoot, value))
    .filter(Boolean))];
}

function getRunId(record) {
  return String(record?.run_id || record?.lock_id || record?.receipt_id || '').trim();
}

function getProcessor(record) {
  return String(record?.processor || record?.claimed_by || '').trim();
}

function getExpiry(record) {
  return record?.expires_at || record?.stale_after || '';
}

function getExpiryDate(record) {
  const expiry = getExpiry(record);
  if (!expiry) return null;
  const date = new Date(expiry);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isLeaseActive(lock, now) {
  const expiresAt = getExpiryDate(lock);
  return Boolean(expiresAt && now.getTime() < expiresAt.getTime());
}

function isLeaseStale(lock, now) {
  const expiresAt = getExpiryDate(lock);
  return Boolean(expiresAt && now.getTime() >= expiresAt.getTime());
}

function ownerMatches(record, options = {}) {
  const processor = resolveProcessor(options);
  const host = resolveHost(options);
  return getProcessor(record) === processor && String(record?.host || '') === host;
}

function sameLockOwnerIdentity(left, right) {
  return getRunId(left) === getRunId(right)
    && String(left?.started_at || '') === String(right?.started_at || '')
    && getProcessor(left) === getProcessor(right)
    && String(left?.host || '') === String(right?.host || '');
}

function getLockVersion(lock) {
  const value = Number(lock?.lock_version || 0);
  return Number.isInteger(value) && value > 0 ? value : 0;
}

function sameLockState(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isLegacyInboxLock(lock) {
  const schemaVersion = lock?.schema_version === undefined
    ? 1
    : Number(lock.schema_version);
  return Boolean(lock
    && typeof lock === 'object'
    && !Array.isArray(lock)
    && schemaVersion < SCHEMA_VERSION
    && lock.status === 'processing'
    && getRunId(lock)
    && getProcessor(lock)
    && lock.started_at
    && !lock.lock_version
    && !lock.host
    && !lock.heartbeat_at
    && !Array.isArray(lock.claimed_paths)
    && !Array.isArray(lock.processed_paths)
    && !Array.isArray(lock.unresolved_paths)
    && getExpiryDate(lock));
}

function validateLockMetadata(lock) {
  if (!lock || typeof lock !== 'object' || Array.isArray(lock)) {
    return 'Inbox processing lock is not a JSON object.';
  }
  if (lock.status !== 'processing') {
    return 'Inbox processing lock has unexpected status ' + String(lock.status || '(missing)') + '.';
  }
  if (!getRunId(lock)) return 'Inbox processing lock is missing run_id.';
  if (!isValidRunId(getRunId(lock))) {
    return 'Inbox processing lock has an unsafe run_id. Use only letters, numbers, dot, underscore, and hyphen.';
  }
  if (!getProcessor(lock)) return 'Inbox processing lock is missing processor.';
  if (!getLockVersion(lock)) return 'Inbox processing lock is missing lock_version.';
  if (!String(lock.host || '').trim()) return 'Inbox processing lock is missing host.';
  if (!lock.started_at || Number.isNaN(new Date(lock.started_at).getTime())) {
    return 'Inbox processing lock has an invalid started_at timestamp.';
  }
  if (!lock.heartbeat_at || Number.isNaN(new Date(lock.heartbeat_at).getTime())) {
    return 'Inbox processing lock has an invalid heartbeat_at timestamp.';
  }
  if (!getExpiryDate(lock)) return 'Inbox processing lock has an invalid expiry timestamp.';
  if (!Array.isArray(lock.claimed_paths)
    || !Array.isArray(lock.processed_paths)
    || !Array.isArray(lock.unresolved_paths)) {
    return 'Inbox processing lock is missing path checkpoint arrays.';
  }
  return null;
}

function validateReceiptMetadata(receipt) {
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) {
    return 'Receipt is not a JSON object.';
  }
  if (receipt.status !== undefined && receipt.status !== 'completed') {
    return 'Receipt has unexpected status ' + String(receipt.status) + '.';
  }
  if (receipt.processed !== undefined && !Array.isArray(receipt.processed)) {
    return 'Receipt processed must be an array.';
  }
  if (receipt.claimed_paths !== undefined && !Array.isArray(receipt.claimed_paths)) {
    return 'Receipt claimed_paths must be an array.';
  }
  if (receipt.unresolved_paths !== undefined && !Array.isArray(receipt.unresolved_paths)) {
    return 'Receipt unresolved_paths must be an array.';
  }
  if (receipt.completed_at !== undefined
    && Number.isNaN(new Date(receipt.completed_at).getTime())) {
    return 'Receipt completed_at is invalid.';
  }
  if (Array.isArray(receipt.processed) && receipt.processed.length > 0
    && (!receipt.completed_at || Number.isNaN(new Date(receipt.completed_at).getTime()))) {
    return 'Receipt with processed paths requires a valid completed_at timestamp.';
  }
  return null;
}

function validateOverrideMetadata(override) {
  if (!override || typeof override !== 'object' || Array.isArray(override)) {
    return 'Override is not a JSON object.';
  }
  if (!String(override.override_id || '').trim()) return 'Override is missing override_id.';
  if (!String(override.type || '').trim()) return 'Override is missing type.';
  if (!String(override.action || '').trim()) return 'Override is missing action.';
  if (!String(override.actor || '').trim()) return 'Override is missing actor.';
  if (!String(override.host || '').trim()) return 'Override is missing host.';
  if (!override.overridden_at || Number.isNaN(new Date(override.overridden_at).getTime())) {
    return 'Override has an invalid overridden_at timestamp.';
  }
  if (!String(override.reason || '').trim()) return 'Override is missing reason.';
  if (override.replacement_run_id !== null
    && override.replacement_run_id !== undefined
    && !isValidRunId(override.replacement_run_id)) {
    return 'Override has an unsafe replacement_run_id.';
  }
  if (override.replaced_lock !== null
    && override.replaced_lock !== undefined
    && (typeof override.replaced_lock !== 'object' || Array.isArray(override.replaced_lock))) {
    return 'Override replaced_lock must be an object or null.';
  }
  return null;
}

export function looksLikeSyncConflictName(name) {
  const text = String(name || '').toLowerCase();
  return /(?:\bconflict(?:ed)?[\s_-]+copy\b|\bcopy[\s_-]+of\b|\bsync[\s_-]+conflict\b|\(\s*conflict(?:ed)?[\s_-]+copy\s*\))/.test(text);
}

function findConflictLockPaths(instanceRoot) {
  const root = path.resolve(instanceRoot);
  const governanceDir = path.join(root, 'governance');
  if (!fs.existsSync(governanceDir)) return [];

  return fs.readdirSync(governanceDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .filter((entry) => entry.name !== path.basename(LOCK_REL_PATH))
    .filter((entry) => entry.name.toLowerCase().includes('inbox-processing.lock'))
    .filter((entry) => entry.name.toLowerCase().endsWith('.json'))
    .filter((entry) => looksLikeSyncConflictName(entry.name))
    .map((entry) => path.join(governanceDir, entry.name));
}

function findInboxConflictPaths(instanceRoot) {
  const root = path.resolve(instanceRoot);
  const inbox = path.join(root, '6-raw', 'inbox');
  if (!fs.existsSync(inbox)) return [];

  const conflicts = [];
  function walk(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name === 'archive') continue;
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(absolute);
      } else if (entry.isFile() && looksLikeSyncConflictName(entry.name)) {
        conflicts.push(relativePath(root, absolute));
      }
    }
  }

  walk(inbox);
  return conflicts.sort((left, right) => left.localeCompare(right));
}

function readReceiptRecords(instanceRoot, receiptsDir) {
  if (!fs.existsSync(receiptsDir)) {
    return {
      receipts: [],
      invalidReceipts: [],
      duplicateReceipts: [],
      conflictReceipts: []
    };
  }

  const receipts = [];
  const invalidReceipts = [];
  const conflictReceipts = [];

  for (const entry of fs.readdirSync(receiptsDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const absolute = path.join(receiptsDir, entry.name);
    const parsed = readJsonIfExists(absolute);
    const receiptPath = relativePath(instanceRoot, absolute);
    if (parsed.error || !parsed.value || typeof parsed.value !== 'object') {
      invalidReceipts.push({
        path: receiptPath,
        error: parsed.error?.message || 'Receipt is not a JSON object.'
      });
      continue;
    }

    const receipt = parsed.value;
    const validationError = validateReceiptMetadata(receipt);
    if (validationError) {
      invalidReceipts.push({
        path: receiptPath,
        error: validationError
      });
      continue;
    }
    const runId = getRunId(receipt) || 'legacy:' + entry.name;

    const record = { path: receiptPath, absolutePath: absolute, receipt, runId };
    receipts.push(record);
    if (looksLikeSyncConflictName(entry.name)) conflictReceipts.push(record);
  }

  const byRunId = new Map();
  for (const record of receipts) {
    const records = byRunId.get(record.runId) || [];
    records.push(record);
    byRunId.set(record.runId, records);
  }

  const duplicateReceipts = [...byRunId.entries()]
    .filter(([, records]) => records.length > 1)
    .map(([runId, records]) => ({
      run_id: runId,
      paths: records.map((record) => record.path).sort((left, right) => left.localeCompare(right))
    }));

  return { receipts, invalidReceipts, duplicateReceipts, conflictReceipts };
}

function readOverrideRecords(instanceRoot, overridesDir) {
  if (!fs.existsSync(overridesDir)) return { overrides: [], invalidOverrides: [] };
  const overrides = [];
  const invalidOverrides = [];
  for (const entry of fs.readdirSync(overridesDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const absolute = path.join(overridesDir, entry.name);
    const parsed = readJsonIfExists(absolute);
    const overridePath = relativePath(instanceRoot, absolute);
    if (parsed.error || !parsed.value || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) {
      invalidOverrides.push({
        path: overridePath,
        error: parsed.error?.message || 'Override is not a JSON object.'
      });
      continue;
    }
    const validationError = validateOverrideMetadata(parsed.value);
    if (validationError) {
      invalidOverrides.push({ path: overridePath, error: validationError });
      continue;
    }
    overrides.push({
      path: overridePath,
      override: parsed.value
    });
  }
  return {
    overrides: overrides.sort((left, right) => left.path.localeCompare(right.path)),
    invalidOverrides: invalidOverrides.sort((left, right) => left.path.localeCompare(right.path))
  };
}

export function getInboxProcessingPaths(instanceRoot) {
  const root = path.resolve(instanceRoot);
  return {
    lockPath: path.join(root, LOCK_REL_PATH),
    lockRelPath: toPortablePath(LOCK_REL_PATH),
    receiptsDir: path.join(root, RECEIPTS_REL_DIR),
    receiptsRelDir: toPortablePath(RECEIPTS_REL_DIR),
    overridesDir: path.join(root, OVERRIDES_REL_DIR),
    overridesRelDir: toPortablePath(OVERRIDES_REL_DIR)
  };
}

export function inspectInboxProcessing(instanceRoot) {
  const root = path.resolve(instanceRoot);
  const paths = getInboxProcessingPaths(root);
  const lockRecord = readJsonIfExists(paths.lockPath);
  const receiptState = readReceiptRecords(root, paths.receiptsDir);
  const conflictLockPaths = findConflictLockPaths(root);
  const overrideState = readOverrideRecords(root, paths.overridesDir);
  const processedPathConflicts = findProcessedPathConflicts(receiptState.receipts, root);

  return {
    lock: lockRecord.value,
    lockPath: lockRecord.exists ? relativePath(root, paths.lockPath) : null,
    lockError: lockRecord.error?.message || null,
    lockValidationError: (lockRecord.error || !lockRecord.exists)
      ? null
      : validateLockMetadata(lockRecord.value),
    conflictLockPaths: conflictLockPaths.map((file) => relativePath(root, file)),
    receipts: receiptState.receipts.map(({ path: receiptPath, receipt, runId }) => ({
      path: receiptPath,
      receipt,
      run_id: runId
    })),
    invalidReceipts: receiptState.invalidReceipts,
    duplicateReceipts: receiptState.duplicateReceipts,
    processedPathConflicts,
    conflictReceipts: receiptState.conflictReceipts.map(({ path: receiptPath, runId }) => ({
      path: receiptPath,
      run_id: runId
    })),
    overrides: overrideState.overrides,
    invalidOverrides: overrideState.invalidOverrides
  };
}

function getReceiptForRun(state, runId) {
  const matches = getReceiptsForRun(state, runId);
  if (matches.length !== 1) return null;
  return matches[0];
}

function getReceiptsForRun(state, runId) {
  return state.receipts.filter((record) => record.run_id === runId);
}

function findProcessedPathConflicts(receipts, instanceRoot) {
  const owners = new Map();
  for (const record of receipts) {
    for (const value of record.receipt.processed || []) {
      const canonical = canonicalizeInboxPath(instanceRoot, value);
      if (!canonical) continue;
      const paths = owners.get(canonical) || new Map();
      const run = paths.get(record.runId) || {
        run_id: record.runId,
        receipt_paths: []
      };
      if (!run.receipt_paths.includes(record.path)) run.receipt_paths.push(record.path);
      paths.set(record.runId, run);
      owners.set(canonical, paths);
    }
  }

  return [...owners.entries()]
    .filter(([, runs]) => runs.size > 1)
    .map(([pathName, runs]) => ({
      path: pathName,
      runs: [...runs.values()].map((run) => ({
        run_id: run.run_id,
        receipt_paths: [...run.receipt_paths].sort((left, right) => left.localeCompare(right))
      }))
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
}

function getProcessedPathsFromState(state, instanceRoot) {
  const processed = new Set();
  for (const record of state.receipts) {
    for (const value of record.receipt.processed || []) {
      const canonical = canonicalizeInboxPath(instanceRoot, value);
      if (canonical) processed.add(canonical);
    }
  }
  return processed;
}

function conflictMessage(state, inboxConflictPaths = []) {
  const conflicts = [
    ...state.conflictLockPaths,
    ...state.conflictReceipts.map((item) => item.path),
    ...inboxConflictPaths
  ];
  if (!conflicts.length && !state.duplicateReceipts.length && !state.processedPathConflicts?.length) return '';

  const details = [];
  if (conflicts.length) {
    details.push('sync conflict copies: ' + [...new Set(conflicts)].join(', '));
  }
  if (state.duplicateReceipts.length) {
    details.push('duplicate receipts: ' + state.duplicateReceipts
      .map((item) => item.run_id + ' (' + item.paths.join(', ') + ')')
      .join('; '));
  }
  if (state.processedPathConflicts?.length) {
    details.push('processed paths claimed by multiple runs: ' + state.processedPathConflicts
      .map((item) => item.path + ' (' + item.runs.map((run) => run.run_id).join(', ') + ')')
      .join('; '));
  }
  return 'Mole found ' + details.join('; ') + '. Preserve every copy and resolve the ambiguity before continuing.';
}

function validateProcessingState(state, options = {}) {
  const inboxConflictPaths = options.checkInboxConflicts === false
    ? []
    : findInboxConflictPaths(options.instanceRoot);
  if (state.processedPathConflicts?.length) {
    return {
      ok: false,
      code: 'PROCESSED_PATH_CONFLICT',
      message: conflictMessage(state, inboxConflictPaths)
        + ' Do not count or reprocess those paths until the receipts are reconciled.'
    };
  }
  const conflict = conflictMessage(state, inboxConflictPaths);
  if (conflict && !options.allowConflictCopies) {
    return {
      ok: false,
      code: 'SYNC_CONFLICT',
      message: conflict
    };
  }
  const legacyLockAllowed = options.allowLegacyLock && isLegacyInboxLock(state.lock);
  if (state.lockError || (state.lockValidationError && !legacyLockAllowed)) {
    return {
      ok: false,
      code: 'INVALID_LOCK',
      message: 'Inbox processing lock is invalid: '
        + (state.lockError || state.lockValidationError)
        + '. Do not replace it automatically; inspect the synced folder history first.'
    };
  }
  if (state.invalidReceipts.length) {
    return {
      ok: false,
      code: 'INVALID_RECEIPT',
      message: 'Inbox processing receipts are invalid: '
        + state.invalidReceipts.map((item) => item.path).join(', ')
        + '. Repair the records before continuing.'
    };
  }
  if (state.invalidOverrides?.length) {
    return {
      ok: false,
      code: 'INVALID_OVERRIDE',
      message: 'Inbox processing override records are invalid: '
        + state.invalidOverrides.map((item) => item.path).join(', ')
        + '. Repair the records before continuing.'
    };
  }
  return { ok: true };
}

function buildLease(instanceRoot, options, now, overrides = {}) {
  const leaseMs = asLeaseMs(options);
  const runId = normalizeRunId(options.runId || options.lockId || overrides.runId);
  const processor = resolveProcessor(options);
  const host = resolveHost(options);
  const expiresAt = new Date(now.getTime() + leaseMs).toISOString();
  const claimedPaths = normalizePathList(instanceRoot, options.claimedPaths || options.claimed_paths || []);
  const processedPaths = normalizePathList(instanceRoot, overrides.processedPaths || []);

  return {
    schema_version: SCHEMA_VERSION,
    lock_version: 1,
    run_id: runId,
    lock_id: runId,
    status: 'processing',
    processor,
    claimed_by: processor,
    host,
    started_at: (overrides.startedAt || now).toISOString(),
    heartbeat_at: now.toISOString(),
    expires_at: expiresAt,
    stale_after: expiresAt,
    lease_duration_ms: leaseMs,
    claimed_paths: claimedPaths,
    processed_paths: processedPaths,
    unresolved_paths: claimedPaths.filter((item) => !processedPaths.includes(item)),
    inbox: '6-raw/inbox',
    ...(overrides.overrideId ? {
      override_id: overrides.overrideId,
      resumed_from_run_id: overrides.resumedFromRunId || null
    } : {})
  };
}

function resultForFailure(code, message, paths, extra = {}) {
  return {
    ok: false,
    code,
    lockPath: paths.lockRelPath,
    ...extra,
    message
  };
}

function validateRequestedRunId(paths, requestedRunId, { required = false } = {}) {
  if (!requestedRunId) {
    if (!required) return null;
    return resultForFailure(
      'RUN_ID_REQUIRED',
      'Every mutating inbox operation requires the exact run ID returned by mole inbox claim. Refusing to operate on a newer or different run.',
      paths
    );
  }
  if (!isValidRunId(requestedRunId)) {
    return resultForFailure(
      'INVALID_RUN_ID',
      'Run ID ' + requestedRunId + ' is invalid. Use 1-128 characters beginning with a letter or number, followed only by letters, numbers, dot, underscore, or hyphen.',
      paths
    );
  }
  return null;
}

function mutationMutexPath(paths) {
  const key = createHash('sha256').update(path.resolve(paths.lockPath)).digest('hex');
  return path.join(os.tmpdir(), MUTATION_MUTEX_PREFIX + key + '.json');
}

function isProcessAlive(pid) {
  const value = Number(pid);
  if (!Number.isInteger(value) || value <= 0) return false;
  try {
    process.kill(value, 0);
    return true;
  } catch (err) {
    return err.code !== 'ESRCH';
  }
}

function acquireMutationMutex(paths, options = {}) {
  const mutexPath = mutationMutexPath(paths);
  const token = randomBytes(12).toString('hex');
  const record = {
    token,
    pid: process.pid,
    processor: resolveProcessor(options),
    host: resolveHost(options),
    acquired_at: new Date().toISOString(),
    lock_path: paths.lockRelPath
  };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      writeJsonExclusive(mutexPath, record);
      return { ok: true, mutexPath, token };
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      const current = readJsonIfExists(mutexPath);
      const holder = current.value;
      const canRecover = attempt === 0
        && holder
        && holder.host === record.host
        && Number(holder.pid) !== process.pid
        && !isProcessAlive(holder.pid);
      if (canRecover) {
        try {
          fs.unlinkSync(mutexPath);
          continue;
        } catch (unlinkError) {
          if (unlinkError.code === 'ENOENT') continue;
        }
      }
      return {
        ok: false,
        mutexPath,
        holder: holder || null
      };
    }
  }

  return { ok: false, mutexPath, holder: null };
}

function releaseMutationMutex(mutex) {
  if (!mutex?.mutexPath) return;
  const current = readJsonIfExists(mutex.mutexPath);
  if (current.value?.token !== mutex.token) return;
  try {
    fs.unlinkSync(mutex.mutexPath);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

function withInboxMutation(instanceRoot, options, operation) {
  const root = path.resolve(instanceRoot);
  const paths = getInboxProcessingPaths(root);
  const mutex = acquireMutationMutex(paths, options);
  if (!mutex.ok) {
    const holder = mutex.holder;
    return resultForFailure(
      'MUTATION_BUSY',
      'Another inbox-processing mutation is in progress for this workspace. Refusing to read and overwrite a moving lock; retry after the other operation finishes.',
      paths,
      { mutationLock: holder }
    );
  }

  try {
    return operation(root, paths);
  } finally {
    releaseMutationMutex(mutex);
  }
}

function replaceLockIfUnchanged(paths, expected, replacement, operation) {
  const current = readJsonIfExists(paths.lockPath);
  if (!current.value
    || !sameLockState(current.value, expected)
    || getLockVersion(current.value) !== getLockVersion(expected)) {
    return {
      ok: false,
      result: resultForFailure(
        'LOCK_CHANGED',
        'The inbox lock changed before the ' + operation + ' could be committed. Refusing to overwrite or select between lock versions.',
        paths,
        { lock: current.value || null }
      )
    };
  }

  writeJsonAtomic(paths.lockPath, replacement);
  const written = readJsonIfExists(paths.lockPath);
  if (!written.value
    || !sameLockState(written.value, replacement)
    || getLockVersion(written.value) !== getLockVersion(replacement)) {
    return {
      ok: false,
      result: resultForFailure(
        'LOCK_CHANGED',
        'The inbox lock changed while the ' + operation + ' was being committed. The new lock state was retained; inspect it before retrying.',
        paths,
        { lock: written.value || null }
      )
    };
  }

  return { ok: true, lock: written.value };
}

function verifyOwnedActiveLock(instanceRoot, options = {}) {
  const paths = getInboxProcessingPaths(instanceRoot);
  const requestedRunId = getRequestedRunId(options);
  const runIdError = validateRequestedRunId(paths, requestedRunId, { required: true });
  if (runIdError) return runIdError;

  const state = inspectInboxProcessing(instanceRoot);
  const validState = validateProcessingState(state, {
    ...options,
    instanceRoot
  });
  if (!validState.ok) return { ...validState, state, paths };

  const lock = state.lock;
  if (!lock) {
    return {
      ...resultForFailure(
        'MISSING_LOCK',
        'No active owned inbox processing claim exists. Run mole inbox claim first, or use --override-missing-lock --reason for an audited recovery.',
        paths
      ),
      state,
      paths
    };
  }

  const lockRunId = getRunId(lock);
  if (requestedRunId !== lockRunId) {
    return {
      ...resultForFailure(
        'RUN_ID_MISMATCH',
        'Inbox processing is owned by run ' + (lockRunId || 'an unknown run')
          + ', not ' + requestedRunId + '. Refusing to complete a different run.',
        paths,
        { lock }
      ),
      state,
      paths
    };
  }

  if (!ownerMatches(lock, options)) {
    return {
      ...resultForFailure(
        'FOREIGN_OWNER',
        'Inbox processing run ' + (lockRunId || 'unknown') + ' is owned by '
          + (getProcessor(lock) || 'an unknown processor') + ' on '
          + (lock.host || 'an unknown host')
          + '. The current processor is not the owner, so completion is refused.',
        paths,
        { lock }
      ),
      state,
      paths
    };
  }

  const now = asDate(options.now, new Date(), 'current time');
  if (!isLeaseActive(lock, now)) {
    const expiry = getExpiry(lock) || 'an unknown time';
    return {
      ...resultForFailure(
        'STALE_LOCK',
        'Inbox processing lease for run ' + (lockRunId || 'unknown')
          + ' expired at ' + expiry
          + '. Normal completion is refused. Inspect synced-folder history and use an explicit stale-lock override with a reason before resuming.',
        paths,
        { lock }
      ),
      state,
      paths
    };
  }

  return { ok: true, lock, state, paths, now };
}

function buildOverrideRecord(instanceRoot, options, details = {}) {
  const paths = getInboxProcessingPaths(instanceRoot);
  const now = asDate(options.now, new Date(), 'override time');
  const actor = resolveProcessor({
    ...options,
    processor: options.overrideBy || options.processor || options.claimedBy
  });
  const host = resolveHost(options);
  const reason = String(options.reason || options.overrideReason || '').trim();
  if (!reason) throw new Error('An explicit override reason is required.');

  const overrideId = options.overrideId
    || 'override-' + formatUtcTimestamp(now) + '-' + randomBytes(5).toString('hex');
  const record = {
    schema_version: SCHEMA_VERSION,
    override_id: overrideId,
    type: details.type || 'stale-lock',
    action: details.action || 'replace-inbox-processing-state',
    actor,
    processor: actor,
    host,
    overridden_at: now.toISOString(),
    reason,
    replaced_lock: details.replacedLock || null,
    replacement_run_id: details.replacementRunId || null
  };

  return {
    record,
    path: path.join(paths.overridesDir, overrideId + '.json')
  };
}

function persistOverrideRecord(audit) {
  try {
    writeJsonExclusive(audit.path, audit.record);
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
    const existing = readJsonIfExists(audit.path);
    if (existing.value && JSON.stringify(existing.value) === JSON.stringify(audit.record)) {
      return audit;
    }
    throw new Error('Override record ' + audit.record.override_id + ' already exists with different contents.');
  }

  return audit;
}

function createOverrideRecord(instanceRoot, options, details = {}) {
  return persistOverrideRecord(buildOverrideRecord(instanceRoot, options, details));
}

function claimInboxProcessingUnlocked(instanceRoot, options = {}) {
  const root = path.resolve(instanceRoot);
  const paths = getInboxProcessingPaths(root);
  const requestedRunId = getRequestedRunId(options);
  const runIdError = validateRequestedRunId(paths, requestedRunId);
  if (runIdError) return runIdError;

  const now = asDate(options.now, new Date(), 'claim time');
  const state = inspectInboxProcessing(root);
  const validState = validateProcessingState(state, {
    ...options,
    instanceRoot: root
  });
  if (!validState.ok) return { ...validState, lockPath: paths.lockRelPath };

  const requestedProcessor = resolveProcessor(options);
  const existingReceipts = requestedRunId ? getReceiptsForRun(state, requestedRunId) : [];
  if (requestedRunId && existingReceipts.length > 1) {
    return resultForFailure(
      'DUPLICATE_RECEIPT',
      'Multiple receipts already exist for run ' + requestedRunId + ': '
        + existingReceipts.map((record) => record.path).join(', ')
        + '. Refusing to choose one or reuse the run ID.',
      paths,
      { duplicateReceipts: existingReceipts.map((record) => record.path) }
    );
  }
  const existingReceipt = existingReceipts[0] || null;
  if (requestedRunId && existingReceipt) {
    if (getProcessor(existingReceipt.receipt) !== requestedProcessor
      || String(existingReceipt.receipt.host || '') !== resolveHost(options)) {
      return resultForFailure(
        'FOREIGN_OWNER',
        'Run ' + requestedRunId + ' already has a receipt owned by '
          + (getProcessor(existingReceipt.receipt) || 'another processor') + ' on '
          + (existingReceipt.receipt.host || 'another host') + '.',
        paths,
        { receipt: existingReceipt.receipt, receiptPath: existingReceipt.path }
      );
    }
    return {
      ok: true,
      idempotent: true,
      run_id: requestedRunId,
      receipt: existingReceipt.receipt,
      receiptPath: existingReceipt.path,
      lockPath: paths.lockRelPath,
      message: 'Inbox processing run ' + requestedRunId
        + ' was already completed; no new claim was created.'
    };
  }

  const runId = normalizeRunId(requestedRunId);
  const lock = state.lock;
  if (lock) {
    const existingRunId = getRunId(lock);
    if (existingRunId === runId) {
      if (!ownerMatches(lock, options)) {
        return resultForFailure(
          'FOREIGN_OWNER',
          'Inbox processing run ' + runId + ' is owned by '
            + (getProcessor(lock) || 'another processor') + ' on '
            + (lock.host || 'an unknown host')
            + '. A different processor cannot retry or replace the run.',
          paths,
          { lock }
        );
      }
      if (isLeaseStale(lock, now)) {
        return resultForFailure(
          'STALE_LOCK',
          'Inbox processing run ' + runId
            + ' has expired. A retry cannot renew it automatically; use an explicit stale-lock override with a reason.',
          paths,
          { lock }
        );
      }
      return {
        ok: true,
        idempotent: true,
        run_id: runId,
        lock,
        lockPath: paths.lockRelPath,
        message: 'Inbox processing run ' + runId + ' is already claimed by ' + getProcessor(lock) + '.'
      };
    }

    const owner = getProcessor(lock) || 'another processor';
    const expiry = getExpiry(lock) ? ' Lease expires at ' + getExpiry(lock) + '.' : '';
    return resultForFailure(
      isLeaseStale(lock, now) ? 'STALE_LOCK' : 'CONCURRENT_CLAIM',
      'Inbox processing already belongs to run ' + (existingRunId || 'unknown')
        + ' claimed by ' + owner + ' on ' + (lock.host || 'an unknown host') + '.'
        + expiry
        + ' Do not replace it automatically; use an explicit stale-lock override only after confirming the synced-folder state.',
      paths,
      { lock }
    );
  }

  const claimedPaths = normalizePathList(root, options.claimedPaths || options.claimed_paths || []);
  const processedPaths = getProcessedPathsFromState(state, root);
  const alreadyProcessed = claimedPaths.filter((item) => processedPaths.has(item));
  if (alreadyProcessed.length) {
    return resultForFailure(
      'ALREADY_PROCESSED',
      'These claimed inbox paths already have completion receipts: ' + alreadyProcessed.join(', ')
        + '. Remove them from the new run instead of reprocessing them.',
      paths,
      { alreadyProcessedPaths: alreadyProcessed }
    );
  }

  const newLock = buildLease(root, { ...options, runId, claimedPaths }, now);
  try {
    writeJsonExclusive(paths.lockPath, newLock);
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
    const racedState = inspectInboxProcessing(root);
    const racedLock = racedState.lock;
    if (racedLock && getRunId(racedLock) === runId) {
      if (!ownerMatches(racedLock, options)) {
        return resultForFailure(
          'FOREIGN_OWNER',
          'Inbox processing run ' + runId + ' was claimed by '
            + (getProcessor(racedLock) || 'another processor') + ' on '
            + (racedLock.host || 'an unknown host') + '.',
          paths,
          { lock: racedLock }
        );
      }
      return {
        ok: true,
        idempotent: true,
        run_id: runId,
        lock: racedLock,
        lockPath: paths.lockRelPath,
        message: 'Inbox processing run ' + runId + ' is already claimed by ' + getProcessor(racedLock) + '.'
      };
    }
    return resultForFailure(
      'CONCURRENT_CLAIM',
      'Another processor created the inbox claim while this claim was being written. Read the lock and do not choose between the claims automatically.',
      paths,
      { lock: racedLock || null }
    );
  }

  return {
    ok: true,
    run_id: runId,
    lock: newLock,
    lockPath: paths.lockRelPath,
    message: 'Inbox processing claimed by ' + newLock.processor + ' on '
      + newLock.host + ' for run ' + runId + '.'
  };
}

export function claimInboxProcessing(instanceRoot, options = {}) {
  return withInboxMutation(instanceRoot, options, (root) => (
    claimInboxProcessingUnlocked(root, options)
  ));
}

function heartbeatInboxProcessingUnlocked(instanceRoot, options = {}) {
  const owned = verifyOwnedActiveLock(instanceRoot, options);
  if (!owned.ok) return owned;

  const now = owned.now;
  const leaseMs = asLeaseMs(options);
  const expiresAt = new Date(now.getTime() + leaseMs).toISOString();
  const updated = {
    ...owned.lock,
    lock_version: getLockVersion(owned.lock) + 1,
    heartbeat_at: now.toISOString(),
    expires_at: expiresAt,
    stale_after: expiresAt,
    lease_duration_ms: leaseMs,
    status: 'processing'
  };

  const replaced = replaceLockIfUnchanged(
    owned.paths,
    owned.lock,
    updated,
    'heartbeat'
  );
  if (!replaced.ok) return replaced.result;

  return {
    ok: true,
    run_id: getRunId(updated),
    lock: replaced.lock,
    lockPath: owned.paths.lockRelPath,
    message: 'Inbox processing lease renewed for run ' + getRunId(updated)
      + ' until ' + updated.expires_at + '.'
  };
}

export function heartbeatInboxProcessing(instanceRoot, options = {}) {
  return withInboxMutation(instanceRoot, options, (root) => (
    heartbeatInboxProcessingUnlocked(root, options)
  ));
}

function checkpointInboxProcessingUnlocked(instanceRoot, options = {}) {
  const owned = verifyOwnedActiveLock(instanceRoot, options);
  if (!owned.ok) return owned;

  const newPaths = normalizePathList(instanceRoot, options.processed || options.processedPaths || []);
  const existingPaths = normalizePathList(instanceRoot, owned.lock.processed_paths || []);
  const processedPaths = [...new Set([...existingPaths, ...newPaths])];
  const claimedPaths = normalizePathList(instanceRoot, owned.lock.claimed_paths || []);
  const unclaimed = claimedPaths.length
    ? processedPaths.filter((item) => !claimedPaths.includes(item))
    : [];
  if (unclaimed.length) {
    return resultForFailure(
      'UNCLAIMED_PATH',
      'The checkpoint includes paths outside this run claim: ' + unclaimed.join(', ')
        + '. Keep each path with the run that claimed it.',
      owned.paths,
      { lock: owned.lock }
    );
  }

  const now = owned.now;
  const leaseMs = asLeaseMs(options);
  const expiresAt = new Date(now.getTime() + leaseMs).toISOString();
  const updated = {
    ...owned.lock,
    lock_version: getLockVersion(owned.lock) + 1,
    heartbeat_at: now.toISOString(),
    expires_at: expiresAt,
    stale_after: expiresAt,
    lease_duration_ms: leaseMs,
    processed_paths: processedPaths,
    unresolved_paths: claimedPaths.filter((item) => !processedPaths.includes(item)),
    last_checkpoint_at: now.toISOString(),
    status: 'processing'
  };

  const replaced = replaceLockIfUnchanged(
    owned.paths,
    owned.lock,
    updated,
    'checkpoint'
  );
  if (!replaced.ok) return replaced.result;

  const added = processedPaths.filter((item) => !existingPaths.includes(item));
  return {
    ok: true,
    idempotent: added.length === 0,
    run_id: getRunId(updated),
    lock: replaced.lock,
    checkpoint: {
      run_id: getRunId(updated),
      checkpointed_at: now.toISOString(),
      processed: processedPaths,
      added
    },
    lockPath: owned.paths.lockRelPath,
    message: added.length
      ? 'Checkpoint saved for run ' + getRunId(updated) + ' with ' + added.length
        + ' newly processed path' + (added.length === 1 ? '' : 's') + '.'
      : 'Checkpoint for run ' + getRunId(updated)
        + ' was already recorded; no paths were added.'
  };
}

export function checkpointInboxProcessing(instanceRoot, options = {}) {
  return withInboxMutation(instanceRoot, options, (root) => (
    checkpointInboxProcessingUnlocked(root, options)
  ));
}

function overrideStaleInboxProcessingUnlocked(instanceRoot, options = {}) {
  const root = path.resolve(instanceRoot);
  const paths = getInboxProcessingPaths(root);
  const replacementRunId = getRequestedRunId(options);
  const runIdError = validateRequestedRunId(paths, replacementRunId, { required: true });
  if (runIdError) return runIdError;

  const state = inspectInboxProcessing(root);
  const legacyLock = isLegacyInboxLock(state.lock);
  const validState = validateProcessingState(state, {
    ...options,
    instanceRoot: root,
    checkInboxConflicts: false,
    allowLegacyLock: legacyLock
  });
  if (!validState.ok) return { ...validState, lockPath: paths.lockRelPath };
  if (!state.lock) {
    return resultForFailure(
      'MISSING_LOCK',
      'There is no stale inbox lock to override. Use an explicit missing-lock completion override only when the run history has been checked.',
      paths
    );
  }

  const now = asDate(options.now, new Date(), 'override time');
  if (!isLeaseStale(state.lock, now)) {
    return resultForFailure(
      'ACTIVE_LOCK',
      'Inbox processing run ' + getRunId(state.lock) + ' is still active until '
        + getExpiry(state.lock) + '. Do not override an active claim.',
      paths,
      { lock: state.lock }
    );
  }

  const existingReceipts = getReceiptsForRun(state, replacementRunId);
  if (existingReceipts.length) {
    return resultForFailure(
      'RUN_ALREADY_COMPLETED',
      'Run ' + replacementRunId + ' already has a completion receipt. Choose a new replacement run ID instead of replacing a completed run.',
      paths,
      {
        receipt: existingReceipts[0].receipt,
        receiptPath: existingReceipts[0].path,
        receipts: existingReceipts.map((record) => record.path)
      }
    );
  }

  const inheritedClaimedPaths = normalizePathList(root, state.lock.claimed_paths || []);
  const requestedClaimedPaths = normalizePathList(
    root,
    options.claimedPaths || options.claimed_paths || []
  );
  const inheritedProcessedPaths = normalizePathList(root, state.lock.processed_paths || []);
  const replacementClaimedPaths = [...new Set([
    ...inheritedClaimedPaths,
    ...requestedClaimedPaths,
    ...inheritedProcessedPaths
  ])];
  const current = readJsonIfExists(paths.lockPath);
  if (!current.value || !sameLockState(current.value, state.lock)) {
    return resultForFailure(
      'LOCK_CHANGED',
      'The stale lock changed before the override could be recorded. No override or replacement lock was written.',
      paths,
      { lock: current.value || null }
    );
  }

  const audit = createOverrideRecord(root, options, {
    type: legacyLock ? 'legacy-stale-lock' : 'stale-lock',
    action: legacyLock ? 'migrate-legacy-stale-lock' : 'replace-stale-lock',
    replacedLock: state.lock,
    replacementRunId
  });
  const replacement = buildLease(root, {
    ...options,
    runId: replacementRunId,
    claimedPaths: replacementClaimedPaths
  }, now, {
    overrideId: audit.record.override_id,
    resumedFromRunId: getRunId(state.lock),
    processedPaths: inheritedProcessedPaths,
    startedAt: now
  });

  const replaced = replaceLockIfUnchanged(
    paths,
    state.lock,
    replacement,
    'stale override'
  );
  if (!replaced.ok) {
    return { ...replaced.result, override: audit.record };
  }

  return {
    ok: true,
    run_id: replacementRunId,
    lock: replaced.lock,
    override: audit.record,
    overridePath: relativePath(root, audit.path),
    lockPath: paths.lockRelPath,
    message: 'Stale inbox lock ' + getRunId(state.lock) + ' was replaced by run '
      + replacementRunId + '. Override ' + audit.record.override_id
      + ' recorded ' + audit.record.reason + '.'
  };
}

export function overrideStaleInboxProcessing(instanceRoot, options = {}) {
  return withInboxMutation(instanceRoot, options, (root) => (
    overrideStaleInboxProcessingUnlocked(root, options)
  ));
}

function prepareMissingLockClaim(instanceRoot, options, now) {
  const paths = getInboxProcessingPaths(instanceRoot);
  const runId = normalizeRunId(options.runId || options.lockId);
  const audit = buildOverrideRecord(instanceRoot, options, {
    type: 'missing-lock',
    action: 'complete-without-active-lock',
    replacedLock: null,
    replacementRunId: runId
  });
  const claim = buildLease(instanceRoot, {
    ...options,
    runId,
    claimedPaths: options.claimedPaths || []
  }, now, {
    overrideId: audit.record.override_id,
    startedAt: asDate(options.startedAt, now, 'run start time')
  });
  return { claim, audit, paths };
}

function buildReceipt(instanceRoot, lock, options, now, override = null) {
  const claimedPaths = normalizePathList(instanceRoot, lock.claimed_paths || []);
  const processedPaths = normalizePathList(instanceRoot, [
    ...(lock.processed_paths || []),
    ...(options.processed || options.processedPaths || [])
  ]);
  const unclaimed = claimedPaths.length
    ? processedPaths.filter((item) => !claimedPaths.includes(item))
    : [];
  if (unclaimed.length) {
    return {
      error: 'Completion includes paths outside this run claim: ' + unclaimed.join(', ') + '.',
      unclaimed
    };
  }

  return {
    receipt: {
      schema_version: SCHEMA_VERSION,
      receipt_id: getRunId(lock),
      run_id: getRunId(lock),
      lock_id: getRunId(lock),
      status: 'completed',
      processor: getProcessor(lock),
      claimed_by: getProcessor(lock),
      host: lock.host || null,
      started_at: lock.started_at,
      heartbeat_at: lock.heartbeat_at || null,
      expires_at: getExpiry(lock) || null,
      completed_at: now.toISOString(),
      claimed_paths: claimedPaths,
      processed: processedPaths,
      unresolved_paths: claimedPaths.filter((item) => !processedPaths.includes(item)),
      summary: options.summary || 'Inbox processing completed.',
      lock_snapshot: lock,
      ...(override ? { override } : {})
    },
    processedPaths
  };
}

function writeOrReadReceipt(paths, receipt) {
  const runId = getRunId(receipt);
  if (!isValidRunId(runId)) {
    throw new Error('Cannot write a receipt for unsafe run ID ' + runId + '.');
  }
  const receiptSuffix = createHash('sha256').update(runId).digest('hex').slice(0, 16);
  const receiptFile = runId + '-' + receiptSuffix + '.json';
  const receiptPath = path.join(paths.receiptsDir, receiptFile);
  const receiptRelPath = toPortablePath(path.join(paths.receiptsRelDir, receiptFile));
  try {
    writeJsonExclusive(receiptPath, receipt);
    return { created: true, receipt, receiptPath: receiptRelPath };
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
    const parsed = readJsonIfExists(receiptPath);
    if (parsed.value && getRunId(parsed.value) === getRunId(receipt)) {
      return { created: false, receipt: parsed.value, receiptPath: receiptRelPath };
    }
    throw new Error('Receipt file ' + receiptRelPath + ' already exists with different contents.');
  }
}

function releaseOwnedLock(paths, lock) {
  const current = readJsonIfExists(paths.lockPath);
  if (current.error) return { released: false, changed: true };
  if (!current.value) return { released: false, changed: false };
  if (!sameLockState(current.value, lock)) return { released: false, changed: true };
  fs.unlinkSync(paths.lockPath);
  return { released: true, changed: false };
}

function completeInboxProcessingUnlocked(instanceRoot, options = {}) {
  const root = path.resolve(instanceRoot);
  const paths = getInboxProcessingPaths(root);
  const requestedRunId = getRequestedRunId(options);
  const runIdError = validateRequestedRunId(paths, requestedRunId, { required: true });
  if (runIdError) return runIdError;

  const now = asDate(options.completedAt || options.now, new Date(), 'completion time');
  const state = inspectInboxProcessing(root);
  const validState = validateProcessingState(state, {
    ...options,
    instanceRoot: root
  });
  if (!validState.ok) return { ...validState, lockPath: paths.lockRelPath };

  let lock = state.lock;
  let override = null;
  let pendingOverride = null;

  if (requestedRunId) {
    const existingReceipt = getReceiptForRun(state, requestedRunId);
    if (existingReceipt) {
      if (getProcessor(existingReceipt.receipt) !== resolveProcessor(options)
        || String(existingReceipt.receipt.host || '') !== resolveHost(options)) {
        return resultForFailure(
          'FOREIGN_OWNER',
          'Run ' + requestedRunId + ' already has a receipt owned by '
            + (getProcessor(existingReceipt.receipt) || 'another processor') + ' on '
            + (existingReceipt.receipt.host || 'another host') + '.',
          paths,
          { receipt: existingReceipt.receipt, receiptPath: existingReceipt.path }
        );
      }
      if (lock && getRunId(lock) !== requestedRunId) {
        return resultForFailure(
          'CONCURRENT_CLAIM',
          'Run ' + requestedRunId + ' is complete, but the active lock belongs to run '
            + getRunId(lock) + '. Refusing to remove the active lock.',
          paths,
          { receipt: existingReceipt.receipt, lock }
        );
      }
      if (lock) {
        const expectedLock = existingReceipt.receipt.lock_snapshot || existingReceipt.receipt;
        if (!sameLockOwnerIdentity(lock, expectedLock)) {
          return resultForFailure(
            'LOCK_CHANGED',
            'Receipt for run ' + requestedRunId
              + ' exists, but the active lock does not match its recorded owner and start time. Refusing to remove it.',
            paths,
            { receipt: existingReceipt.receipt, lock }
          );
        }
        const release = releaseOwnedLock(paths, expectedLock);
        if (release.changed) {
          return resultForFailure(
            'LOCK_CHANGED',
            'Receipt for run ' + requestedRunId
              + ' already exists, but the lock changed before it could be released. The receipt is retained; inspect the lock before continuing.',
            paths,
            { receipt: existingReceipt.receipt, lock: state.lock }
          );
        }
      }
      return {
        ok: true,
        idempotent: true,
        run_id: requestedRunId,
        receipt: existingReceipt.receipt,
        receiptPath: existingReceipt.path,
        lockPath: paths.lockRelPath,
        message: 'Inbox processing receipt for run ' + requestedRunId
          + ' already exists; no duplicate receipt or processing event was created.'
      };
    }
  }

  if (!lock) {
    if (!options.overrideMissingLock) {
      return resultForFailure(
        'MISSING_LOCK',
        'No active owned inbox processing claim exists. Run mole inbox claim first, or use --override-missing-lock --reason for an audited recovery.',
        paths
      );
    }
    if (!String(options.reason || options.overrideReason || '').trim()) {
      return resultForFailure(
        'OVERRIDE_REASON_REQUIRED',
        'Missing-lock completion requires an explicit override reason. No receipt was written.',
        paths
      );
    }
    const created = prepareMissingLockClaim(root, options, now);
    lock = created.claim;
    override = created.audit.record;
    pendingOverride = created.audit;
  } else {
    const owned = verifyOwnedActiveLock(root, { ...options, now });
    if (!owned.ok) return owned;
    lock = owned.lock;
  }

  const built = buildReceipt(root, lock, options, now, override);
  if (built.error) {
    return resultForFailure('UNCLAIMED_PATH', built.error, paths, { lock });
  }

  const previouslyProcessed = getProcessedPathsFromState(state, root);
  const alreadyProcessed = built.processedPaths.filter((item) => previouslyProcessed.has(item));
  if (alreadyProcessed.length) {
    return resultForFailure(
      'ALREADY_PROCESSED',
      'These paths are already covered by another completion receipt: '
        + alreadyProcessed.join(', ')
        + '. Refusing to create a second processing event.',
      paths,
      { lock, alreadyProcessedPaths: alreadyProcessed }
    );
  }

  const receiptState = inspectInboxProcessing(root);
  const duplicate = receiptState.duplicateReceipts.find((item) => item.run_id === getRunId(lock));
  if (duplicate) {
    return resultForFailure(
      'DUPLICATE_RECEIPT',
      'Multiple receipts already exist for run ' + getRunId(lock) + ': '
        + duplicate.paths.join(', ') + '. Refusing to choose one.',
      paths,
      { lock, duplicateReceipts: [duplicate] }
    );
  }

  if (pendingOverride) persistOverrideRecord(pendingOverride);

  const written = writeOrReadReceipt(paths, built.receipt);
  if (!written.created) {
    return {
      ok: true,
      idempotent: true,
      run_id: getRunId(lock),
      receipt: written.receipt,
      receiptPath: written.receiptPath,
      lockPath: paths.lockRelPath,
      message: 'Inbox processing receipt for run ' + getRunId(lock)
        + ' already exists; no duplicate receipt or processing event was created.'
    };
  }

  if (state.lock) {
    const release = releaseOwnedLock(paths, state.lock);
    if (release.changed) {
      return {
        ok: true,
        receipt: written.receipt,
        receiptPath: written.receiptPath,
        lockPath: paths.lockRelPath,
        warning: 'Receipt was written, but the lock changed before release. Inspect the active lock before continuing.',
        message: 'Inbox processing receipt written to ' + written.receiptPath
          + ', but the lock was not removed because it changed.'
      };
    }
  }

  return {
    ok: true,
    idempotent: false,
    run_id: getRunId(lock),
    receipt: written.receipt,
    receiptPath: written.receiptPath,
    lockPath: paths.lockRelPath,
    override,
    message: 'Inbox processing receipt written to ' + written.receiptPath + '.'
  };
}

export function completeInboxProcessing(instanceRoot, options = {}) {
  return withInboxMutation(instanceRoot, options, (root) => (
    completeInboxProcessingUnlocked(root, options)
  ));
}
