import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export const SOURCE_REGISTRY_REL_PATH = path.join('governance', 'source-registry.json');
export const SOURCE_REGISTRY_SCHEMA_VERSION = 1;
export const SOURCE_ID_PREFIX = 'src_';
export const SOURCE_HASH_ALGORITHM = 'sha256';

const DEFAULT_RETENTION = Object.freeze({
  policy: 'workspace-default',
  retain_until: null,
  legal_hold: false
});

const SKIPPED_DIRECTORIES = new Set(['.git', 'node_modules']);
export const SOURCE_REGISTRY_LOCK_REL_PATH = path.join('governance', 'source-registry.json.lock');
const SOURCE_REGISTRY_LOCK_STALE_MS = 30_000;
const TEXT_SOURCE_EXTENSIONS = new Set([
  '.csv', '.htm', '.html', '.json', '.log', '.md', '.mdx', '.ndjson',
  '.rst', '.toml', '.tsv', '.txt', '.xml', '.yaml', '.yml'
]);
const LEGACY_REFERENCE_ROOTS = [
  '2-summaries',
  '3-indexes',
  '4-context',
  '5-evidence',
  '6-raw',
  'governance'
];
const SCAFFOLD_GUIDANCE_FILES = new Set([
  '2-summaries/user-summary.md',
  '4-context/personas.md',
  '4-context/stakeholders.md',
  '6-raw/inbox/README.md',
  'governance/run-receipts/README.md'
]);
const SEARCH_ROOTS = [
  '0-bootstrap',
  '1-routing',
  '2-summaries',
  '3-indexes',
  '4-context',
  '5-evidence',
  '6-raw',
  'governance',
  'docs'
];

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function nowIso(options = {}) {
  return (options.now || new Date()).toISOString();
}

function asText(value) {
  return String(value ?? '').trim();
}

function toPortablePath(value) {
  return String(value || '').split(path.sep).join('/');
}

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function workspaceRelativePath(instanceRoot, value) {
  const root = path.resolve(instanceRoot);
  const absolute = path.resolve(root, String(value || ''));
  if (!isInside(root, absolute) || absolute === root) return null;
  return toPortablePath(path.relative(root, absolute));
}

function absoluteWorkspacePath(instanceRoot, value) {
  const root = path.resolve(instanceRoot);
  const text = asText(value);
  if (!text) return null;
  const absolute = path.isAbsolute(text) ? path.normalize(text) : path.resolve(root, text);
  return isInside(root, absolute) ? absolute : null;
}

function registryPath(instanceRoot) {
  return path.join(path.resolve(instanceRoot), SOURCE_REGISTRY_REL_PATH);
}

function emptyRegistry(updatedAt = null) {
  return {
    schema_version: SOURCE_REGISTRY_SCHEMA_VERSION,
    registry: 'mole-source-registry',
    updated_at: updatedAt,
    records: []
  };
}

function sleepSync(milliseconds) {
  const signal = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(signal, 0, 0, milliseconds);
}

function processIsAlive(pid) {
  const value = Number(pid);
  if (!Number.isInteger(value) || value <= 0) return false;
  try {
    process.kill(value, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
}
}
function acquireSourceRegistryLock(instanceRoot, options = {}) {
  const root = path.resolve(instanceRoot);
  const lockFile = path.join(root, SOURCE_REGISTRY_LOCK_REL_PATH);
  const startedAt = Date.now();
  const timeout = Number(options.lockTimeoutMs || 5_000);
  const token = randomUUID();
  ensureDir(path.dirname(lockFile));

  while (true) {
    try {
      const descriptor = fs.openSync(lockFile, 'wx');
      try {
        fs.writeSync(
          descriptor,
          JSON.stringify({ pid: process.pid, token, created_at: new Date().toISOString() }) + '\n',
          null,
          'utf8'
        );
        fs.fsyncSync(descriptor);
      } finally {
        fs.closeSync(descriptor);
      }
      return { path: lockFile, token };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      try {
        const stat = fs.statSync(lockFile);
        let owner = null;
        try {
          owner = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
        } catch {
          // A partially written lock is only reclaimable once it is old.
        }
        if (!processIsAlive(owner?.pid) && Date.now() - stat.mtimeMs > SOURCE_REGISTRY_LOCK_STALE_MS) {
          fs.unlinkSync(lockFile);
          continue;
        }
      } catch (statError) {
        if (statError.code !== 'ENOENT') throw statError;
        continue;
      }
      if (Date.now() - startedAt >= timeout) {
        throw new Error('Timed out waiting for the source registry lock.');
      }
      sleepSync(Math.min(25, Math.max(1, timeout - (Date.now() - startedAt))));
    }
  }
}

function releaseSourceRegistryLock(lock) {
  const lockFile = typeof lock === 'string' ? lock : lock.path;
  const token = typeof lock === 'object' ? lock.token : null;
  if (token) {
    let owner;
    try {
      owner = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') return;
      return;
    }
    if (owner?.token !== token) return;
  }
  try {
    fs.unlinkSync(lockFile);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

function withSourceRegistryLock(instanceRoot, callback, options = {}) {
  if (options.locked) return callback();
  const lock = acquireSourceRegistryLock(instanceRoot, options);
  try {
    return callback();
  } finally {
    releaseSourceRegistryLock(lock);
  }
}

function writeJson(file, value) {
  ensureDir(path.dirname(file));
  const temporary = file + '.' + process.pid + '.' + randomUUID() + '.tmp';
  const serialized = JSON.stringify(value, null, 2) + '\n';
  const descriptor = fs.openSync(temporary, 'wx');
  try {
    fs.writeSync(descriptor, serialized, null, 'utf8');
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  try {
    fs.renameSync(temporary, file);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

function readRegistryFile(instanceRoot) {
  const file = registryPath(instanceRoot);
  if (!fs.existsSync(file)) return emptyRegistry();
  const value = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!value || typeof value !== 'object' || !Array.isArray(value.records)) {
    throw new Error(`Invalid source registry: ${SOURCE_REGISTRY_REL_PATH}`);
  }
  return {
    ...emptyRegistry(value.updated_at || null),
    ...value,
    schema_version: value.schema_version || SOURCE_REGISTRY_SCHEMA_VERSION,
    records: value.records
  };
}

export function getSourceRegistryPath(instanceRoot) {
  return registryPath(instanceRoot);
}

export function loadSourceRegistry(instanceRoot) {
  return readRegistryFile(instanceRoot);
}

function saveSourceRegistryUnlocked(instanceRoot, registry, options = {}) {
  const updatedAt = options.updatedAt || new Date().toISOString();
  const next = {
    ...emptyRegistry(updatedAt),
    ...registry,
    schema_version: SOURCE_REGISTRY_SCHEMA_VERSION,
    registry: 'mole-source-registry',
    updated_at: updatedAt,
    records: Array.isArray(registry?.records) ? registry.records : []
  };
  writeJson(registryPath(instanceRoot), next);
  return next;
}

export function saveSourceRegistry(instanceRoot, registry, options = {}) {
  const root = path.resolve(instanceRoot);
  return withSourceRegistryLock(root, () => saveSourceRegistryUnlocked(root, registry, options), options);
}

export function createStarterSourceRegistry(instanceRoot, options = {}) {
  const root = path.resolve(instanceRoot);
  return withSourceRegistryLock(root, () => {
    const file = registryPath(root);
    if (fs.existsSync(file)) return readRegistryFile(root);
    const updatedAt = options.now ? options.now.toISOString() : null;
    return saveSourceRegistryUnlocked(root, emptyRegistry(updatedAt), { updatedAt });
  }, options);
}

export function createSourceId(options = {}) {
  const supplied = asText(options.sourceId || options.source_id);
  if (supplied) return supplied;
  return `${SOURCE_ID_PREFIX}${randomUUID()}`;
}

function normalizeDate(value) {
  const text = asText(value);
  if (!text) return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? text.slice(0, 10) : date.toISOString().slice(0, 10);
}

function normalizeIso(value, fallback = null) {
  const text = asText(value);
  if (!text) return fallback;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? text : date.toISOString();
}

function parseFrontmatterScalar(value) {
  const text = asText(value);
  if (!text) return '';
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    return text.slice(1, -1);
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export function parseSourceFrontmatter(content) {
  const text = String(content || '');
  if (!text.startsWith('---')) return {};
  const end = text.indexOf('\n---', 3);
  if (end < 0) return {};

  const fields = {};
  const frontmatter = text.slice(4, end).split(/\r?\n/);
  for (const line of frontmatter) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) continue;
    fields[match[1]] = parseFrontmatterScalar(match[2]);
  }
  return fields;
}

export function readSourceFrontmatter(filePath) {
  try {
    return parseSourceFrontmatter(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return {};
  }
}

function canonicalSourceContent(content) {
  const text = String(content || '');
  if (!text.startsWith('---')) return text;
  const end = text.indexOf('\n---', 3);
  if (end < 0) return text;
  const frontmatter = text.slice(0, end).replace(/^content_hash:\s*.*(?:\r?\n|$)/m, '');
  return frontmatter + text.slice(end);
}

export function hashSourceContent(content) {
  const digest = createHash(SOURCE_HASH_ALGORITHM)
    .update(Buffer.from(canonicalSourceContent(content), 'utf8'))
    .digest('hex');
  return `${SOURCE_HASH_ALGORITHM}:${digest}`;
}

export function hashSourceBytes(bytes) {
  const digest = createHash(SOURCE_HASH_ALGORITHM)
    .update(Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes))
    .digest('hex');
  return SOURCE_HASH_ALGORITHM + ':' + digest;
}

function isTextSourceFile(filePath, options = {}) {
  if (options.textual === true) return true;
  return TEXT_SOURCE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

export function hashSourceFile(filePath, options = {}) {
  const bytes = fs.readFileSync(filePath);
  if (isTextSourceFile(filePath, options)) return hashSourceContent(bytes.toString('utf8'));
  return hashSourceBytes(bytes);
}

export function addContentHash(content) {
  const text = String(content || '');
  const hash = hashSourceContent(text);
  if (/^content_hash:\s*/m.test(text)) {
    return text.replace(/^content_hash:\s*.*$/m, `content_hash: ${hash}`);
  }
  if (text.startsWith('---\n')) return text.replace(/^---\n/, `---\ncontent_hash: ${hash}\n`);
  return text;
}

function normalizeSourceReference(value, fallbackPath = null) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const kind = asText(value.kind || value.type) || 'file';
    const referenceValue = asText(value.value || value.reference || value.path);
    return {
      kind,
      value: referenceValue || fallbackPath || null
    };
  }
  const text = asText(value);
  return {
    kind: 'file',
    value: text || fallbackPath || null
  };
}

function normalizeRetention(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ...DEFAULT_RETENTION };
  return {
    ...DEFAULT_RETENTION,
    ...value,
    retain_until: value.retain_until ? normalizeDate(value.retain_until) : null,
    legal_hold: value.legal_hold === true
  };
}

function normalizeAttachments(instanceRoot, attachments = []) {
  return (Array.isArray(attachments) ? attachments : [])
    .map((attachment) => {
      if (typeof attachment === 'string') {
        const relative = workspaceRelativePath(instanceRoot, attachment) || attachment;
        return {
          source_id: null,
          path: relative,
          name: path.basename(relative),
          content_hash: null,
          media_type: null
        };
      }
      if (!attachment || typeof attachment !== 'object') return null;
      return {
        source_id: asText(attachment.source_id || attachment.sourceId) || null,
        path: asText(attachment.path) || null,
        name: asText(attachment.name) || null,
        content_hash: asText(attachment.content_hash || attachment.contentHash) || null,
        media_type: asText(attachment.media_type || attachment.mediaType) || null,
        source_reference: attachment.source_reference || attachment.sourceReference || undefined
      };
    })
    .filter(Boolean);
}

function normalizePathHistory(value, fallbackPath, observedAt, reason = 'captured') {
  const history = Array.isArray(value) ? value : [];
  const normalized = [];
  for (const entry of history) {
    const item = typeof entry === 'string' ? { path: entry } : entry;
    if (!item || !asText(item.path)) continue;
    if (normalized.some((candidate) => candidate.path === item.path)) continue;
    normalized.push({
      path: toPortablePath(item.path),
      observed_at: normalizeIso(item.observed_at, observedAt),
      reason: asText(item.reason) || reason
    });
  }
  if (fallbackPath && !normalized.some((entry) => entry.path === fallbackPath)) {
    normalized.push({ path: fallbackPath, observed_at: observedAt, reason });
  }
  return normalized;
}

function normalizeHashHistory(value, contentHash, observedAt, reason = 'captured') {
  const history = Array.isArray(value) ? value : [];
  const normalized = [];
  for (const entry of history) {
    const item = typeof entry === 'string' ? { content_hash: entry } : entry;
    if (!item || !asText(item.content_hash)) continue;
    if (normalized.some((candidate) => candidate.content_hash === item.content_hash)) continue;
    normalized.push({
      content_hash: item.content_hash,
      observed_at: normalizeIso(item.observed_at, observedAt),
      reason: asText(item.reason) || reason
    });
  }
  if (contentHash && !normalized.some((entry) => entry.content_hash === contentHash)) {
    normalized.push({ content_hash: contentHash, observed_at: observedAt, reason });
  }
  return normalized;
}

function inferOriginalDate(frontmatter, options = {}, stat = null) {
  return normalizeDate(
    options.originalDate || options.original_date || frontmatter.original_date || frontmatter.date ||
      frontmatter.created_at || frontmatter.captured_at || (stat ? stat.mtime : null)
  );
}

function inferCapturedAt(frontmatter, options = {}, observedAt) {
  return normalizeIso(options.capturedAt || options.captured_at || frontmatter.captured_at || frontmatter.created_at, observedAt);
}

function inferSourceType(frontmatter, options = {}) {
  return asText(options.sourceType || options.source_type || frontmatter.source_type) || 'local_file';
}

function inferChannel(frontmatter, options = {}) {
  return asText(options.channel || frontmatter.channel) || 'file';
}

function inferVisibility(frontmatter, options = {}) {
  return asText(options.visibility || frontmatter.visibility) || 'internal';
}

function makeRecord(instanceRoot, filePath, options = {}) {
  const observedAt = normalizeIso(options.observedAt, nowIso(options));
  const absolute = filePath ? path.resolve(instanceRoot, filePath) : null;
  const currentPath = options.currentPath === null
    ? null
    : workspaceRelativePath(instanceRoot, options.currentPath || absolute);
  const content = options.content !== undefined
    ? String(options.content)
    : absolute && fs.existsSync(absolute) ? fs.readFileSync(absolute, 'utf8') : '';
  const frontmatter = options.frontmatter || parseSourceFrontmatter(content);
  const sourceId = createSourceId({ sourceId: options.sourceId || options.source_id || frontmatter.source_id });
  const contentHash = options.contentHash || options.content_hash ||
    (options.content !== undefined ? hashSourceContent(content) :
      absolute && fs.existsSync(absolute) ? hashSourceFile(absolute) : hashSourceContent(content));
  const originalPath = options.originalPath === null
    ? null
    : toPortablePath(asText(options.originalPath || currentPath || frontmatter.original_path));
  const sourceReference = normalizeSourceReference(
    options.sourceReference || options.source_reference || frontmatter.source_reference,
    currentPath || originalPath
  );
  const attachments = normalizeAttachments(instanceRoot, options.attachments || frontmatter.attachments);
  const capturedAt = inferCapturedAt(frontmatter, options, observedAt);

  return {
    schema_version: SOURCE_REGISTRY_SCHEMA_VERSION,
    source_id: sourceId,
    content_hash: contentHash,
    hash_algorithm: SOURCE_HASH_ALGORITHM,
    source_type: inferSourceType(frontmatter, options),
    original_date: inferOriginalDate(frontmatter, options, absolute && fs.existsSync(absolute) ? fs.statSync(absolute) : null),
    captured_at: capturedAt,
    channel: inferChannel(frontmatter, options),
    source_reference: sourceReference,
    attachments,
    visibility: inferVisibility(frontmatter, options),
    retention: normalizeRetention(options.retention || options.retention_metadata || frontmatter.retention),
    original_path: originalPath || currentPath,
    current_path: currentPath,
    path_history: normalizePathHistory(options.pathHistory || options.path_history, originalPath || currentPath, observedAt),
    hash_history: normalizeHashHistory(options.hashHistory || options.hash_history, contentHash, observedAt, options.hashReason || 'captured'),
    status: asText(options.status) || 'active'
  };
}

export function createSourceRecord(instanceRoot, filePath, options = {}) {
  return makeRecord(path.resolve(instanceRoot), filePath, options);
}

function findRecordById(records, sourceId) {
  return records.find((record) => record.source_id === sourceId) || null;
}

function pathEntries(record) {
  return [
    record.original_path,
    record.current_path,
    ...(record.path_history || []).map((entry) => typeof entry === 'string' ? entry : entry.path)
  ].filter(Boolean);
}

function recordMatchesPath(record, relativePath) {
  return pathEntries(record).includes(relativePath);
}

function observeRecord(instanceRoot, record, observedPath, options = {}) {
  const observedAt = normalizeIso(options.observedAt, nowIso(options));
  const nextPath = observedPath ? workspaceRelativePath(instanceRoot, observedPath) || toPortablePath(observedPath) : null;
  const previousPath = record.current_path;
  let pathChanged = false;
  const previousHash = record.content_hash;

  if (nextPath && previousPath !== nextPath) {
    record.path_history = normalizePathHistory(record.path_history, previousPath, observedAt, 'moved');
    record.path_history = normalizePathHistory(record.path_history, nextPath, observedAt, options.pathReason || 'observed');
    record.current_path = nextPath;
    pathChanged = true;
  }

  if (options.contentHash && options.contentHash !== record.content_hash) {
    record.hash_history = normalizeHashHistory(record.hash_history, record.content_hash, observedAt, 'previous');
    record.hash_history = normalizeHashHistory(record.hash_history, options.contentHash, observedAt, options.hashReason || 'corrected');
    record.content_hash = options.contentHash;
    record.hash_algorithm = SOURCE_HASH_ALGORITHM;
    record.last_content_change_at = observedAt;
    record.last_content_change_reason = options.hashReason || 'corrected';
  }

  if (options.attachments) record.attachments = normalizeAttachments(instanceRoot, options.attachments);
  if (options.originalDate || options.original_date) record.original_date = normalizeDate(options.originalDate || options.original_date);
  if (options.sourceType || options.source_type) record.source_type = asText(options.sourceType || options.source_type);
  if (options.channel) record.channel = asText(options.channel);
  if (options.sourceReference || options.source_reference) record.source_reference = normalizeSourceReference(options.sourceReference || options.source_reference, record.current_path);
  if (options.visibility) record.visibility = asText(options.visibility);
  if (options.retention) record.retention = normalizeRetention(options.retention);
  record.schema_version = SOURCE_REGISTRY_SCHEMA_VERSION;
  return { record, pathChanged, hashChanged: Boolean(options.contentHash && options.contentHash !== previousHash) };
}

function attachmentRecords(instanceRoot, parent, registry, options = {}) {
  const attachments = [];
  for (const attachment of parent.attachments || []) {
    if (!attachment.path) continue;
    const absolute = absoluteWorkspacePath(instanceRoot, attachment.path);
    if (!absolute || !fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) continue;
    const frontmatter = readSourceFrontmatter(absolute);
    const sourceId = asText(attachment.source_id || frontmatter.source_id);
    const contentHash = hashSourceFile(absolute);
    const matchingRecords = sourceId
      ? [findRecordById(registry.records, sourceId)].filter(Boolean)
      : registry.records.filter((record) => recordMatchesPath(record, attachment.path) && hashMatches(record.content_hash, contentHash));
    if (matchingRecords.length > 1) {
      throw new Error(`Attachment source is ambiguous for ${attachment.path}; multiple records share its path and content hash.`);
    }
    const existing = matchingRecords[0] || null;
    if (existing) {
      attachment.source_id = existing.source_id;
      attachment.content_hash = existing.content_hash;
      continue;
    }
    const child = makeRecord(instanceRoot, absolute, {
      sourceId: sourceId || undefined,
      contentHash,
      sourceType: 'attachment',
      channel: options.channel || 'attachment',
      originalPath: attachment.path,
      currentPath: attachment.path,
      sourceReference: attachment.source_reference || { kind: 'file', value: attachment.path },
      observedAt: options.observedAt
    });
    child.attachments = [];
    registry.records.push(child);
    attachment.source_id = child.source_id;
    attachment.content_hash = child.content_hash;
  }
  return attachments;
}

function registerSourceFileLocked(instanceRoot, filePath, options = {}) {
  const root = path.resolve(instanceRoot);
  const absolute = path.isAbsolute(String(filePath || '')) ? path.resolve(filePath) : path.resolve(root, String(filePath || ''));
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
    throw new Error(`Source file does not exist: ${filePath}`);
  }

  const registry = readRegistryFile(root);
  const frontmatter = readSourceFrontmatter(absolute);
  const relative = workspaceRelativePath(root, absolute);
  const observedAt = normalizeIso(options.observedAt, nowIso(options));
  const sourceId = asText(options.sourceId || options.source_id || frontmatter.source_id);
  const hash = options.contentHash || options.content_hash || hashSourceFile(absolute);
  const existingById = sourceId ? findRecordById(registry.records, sourceId) : null;
  const existingByPath = relative ? registry.records.filter((record) => recordMatchesPath(record, relative)) : [];
  const existingByPathMatch = !sourceId && existingByPath.length === 1 && hashMatches(existingByPath[0].content_hash, hash) ? existingByPath[0] : null;
  const liveCandidates = sourceId ? liveSourceIdCandidates(root, sourceId, options) : [];
  if (sourceId && relative && !liveCandidates.some((candidate) => candidate.path === relative)) {
    liveCandidates.push({ path: relative, source_id: sourceId });
  }
  if (sourceId && liveCandidates.length > 1) {
    const finding = liveSourceIdFinding(sourceId, liveCandidates);
    return {
      ok: false,
      status: 'ambiguous',
      created: false,
      source_id: sourceId,
      record: existingById,
      conflicts: [finding],
      conflict: true,
      reason: 'duplicate-live-source-id'
    };
  }

  let record;
  let created = false;
  if (existingById || existingByPathMatch) {
    record = existingById || existingByPathMatch;
    observeRecord(root, record, absolute, {
      observedAt,
      contentHash: hash,
      hashReason: options.hashReason || 'corrected',
      pathReason: options.pathReason || 'observed',
      attachments: options.attachments || record.attachments,
      originalDate: options.originalDate || options.original_date,
      sourceType: options.sourceType || options.source_type,
      channel: options.channel,
      sourceReference: options.sourceReference || options.source_reference,
      visibility: options.visibility,
      retention: options.retention
    });
  } else {
    record = makeRecord(root, absolute, {
      ...options,
      sourceId: sourceId || existingByPathMatch?.source_id || undefined,
      contentHash: hash,
      observedAt,
      currentPath: relative,
      originalPath: options.originalPath || relative,
      frontmatter
    });
    registry.records.push(record);
    created = true;
  }

  const attachmentOptions = {
    channel: options.channel,
    observedAt
  };
  attachmentRecords(root, record, registry, attachmentOptions);
  const conflicts = findSourceConflictsFromRegistry(registry).concat(findLiveSourceIdConflicts(root, options));
  saveSourceRegistry(root, registry, { updatedAt: observedAt, locked: true });

  return {
    ok: true,
    created,
    record,
    conflicts,
    conflict: existingByPath.some((candidate) => candidate.source_id !== record.source_id && candidate.content_hash !== hash)
  };
}

export function registerSourceFile(instanceRoot, filePath, options = {}) {
  const root = path.resolve(instanceRoot);
  return withSourceRegistryLock(root, () => registerSourceFileLocked(root, filePath, options), options);
}

function registerSourceRecordLocked(instanceRoot, recordOrFilePath, options = {}) {
  if (typeof recordOrFilePath === 'string') return registerSourceFileLocked(instanceRoot, recordOrFilePath, options);
  const root = path.resolve(instanceRoot);
  const registry = readRegistryFile(root);
  const record = {
    ...recordOrFilePath,
    schema_version: SOURCE_REGISTRY_SCHEMA_VERSION,
    source_id: createSourceId(recordOrFilePath || {}),
    hash_algorithm: recordOrFilePath.hash_algorithm || SOURCE_HASH_ALGORITHM,
    attachments: normalizeAttachments(root, recordOrFilePath.attachments),
    retention: normalizeRetention(recordOrFilePath.retention),
    path_history: normalizePathHistory(recordOrFilePath.path_history, recordOrFilePath.original_path || recordOrFilePath.current_path, recordOrFilePath.captured_at || new Date().toISOString()),
    hash_history: normalizeHashHistory(recordOrFilePath.hash_history, recordOrFilePath.content_hash, recordOrFilePath.captured_at || new Date().toISOString())
  };
  const duplicate = findRecordById(registry.records, record.source_id);
  if (duplicate) {
    throw new Error(`Source ID already exists: ${record.source_id}`);
  }
  registry.records.push(record);
  saveSourceRegistry(root, registry, { updatedAt: options.updatedAt, locked: true });
  return { ok: true, created: true, record, conflicts: findSourceConflictsFromRegistry(registry).concat(findLiveSourceIdConflicts(root, options)) };
}

export function registerSource(instanceRoot, recordOrFilePath, options = {}) {
  const root = path.resolve(instanceRoot);
  return withSourceRegistryLock(root, () => registerSourceRecordLocked(root, recordOrFilePath, options), options);
}

function walkFiles(root, current, files) {
  if (!fs.existsSync(current)) return;
  for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
    if (entry.name.startsWith('.') && entry.name !== '.well-known') continue;
    if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
    const absolute = path.join(current, entry.name);
    if (entry.isDirectory()) walkFiles(root, absolute, files);
    else if (entry.isFile()) files.push(absolute);
  }
}

function workspaceFiles(instanceRoot, options = {}) {
  const root = path.resolve(instanceRoot);
  const files = [];
  const roots = options.searchRoots || SEARCH_ROOTS;
  for (const relative of roots) walkFiles(root, path.join(root, relative), files);
  return files.filter((file) => {
    const relative = toPortablePath(path.relative(root, file));
    return relative !== toPortablePath(SOURCE_REGISTRY_REL_PATH) &&
      relative !== toPortablePath(SOURCE_REGISTRY_LOCK_REL_PATH);
  });
}

function frontmatterDate(filePath, stat = null) {
  const fields = readSourceFrontmatter(filePath);
  return normalizeDate(fields.original_date || fields.date || fields.created_at || fields.captured_at || (stat ? stat.mtime : null));
}

function candidateForFile(instanceRoot, filePath) {
  const root = path.resolve(instanceRoot);
  const stat = fs.statSync(filePath);
  const frontmatter = readSourceFrontmatter(filePath);
  return {
    path: workspaceRelativePath(root, filePath),
    absolute_path: filePath,
    source_id: asText(frontmatter.source_id) || null,
    content_hash: hashSourceFile(filePath),
    original_date: frontmatterDate(filePath, stat),
    source_type: asText(frontmatter.source_type) || 'local_file'
  };
}

function findWorkspaceCandidates(instanceRoot, options = {}) {
  const candidates = [];
  for (const file of workspaceFiles(instanceRoot, options)) {
    try {
      candidates.push(candidateForFile(instanceRoot, file));
    } catch {
      // A file that disappears or cannot be read during a migration is not a proof candidate.
    }
  }
  return candidates;
}
function liveSourceIdCandidates(instanceRoot, sourceId, options = {}) {
  return findWorkspaceCandidates(instanceRoot, options)
    .filter((candidate) => candidate.source_id === sourceId);
}

function liveSourceIdFinding(sourceId, candidates) {
  return {
    severity: 'conflict',
    code: 'live-duplicate-source-id',
    source_id: sourceId,
    paths: [...new Set(candidates.map((candidate) => candidate.path).filter(Boolean))],
    message: 'Source ID ' + sourceId + ' appears in multiple live files; resolution is ambiguous. Preserve both files and review manually.'
  };
}

function findLiveSourceIdConflicts(instanceRoot, options = {}) {
  const byId = new Map();
  for (const candidate of findWorkspaceCandidates(instanceRoot, options)) {
    if (!candidate.source_id) continue;
    const candidates = byId.get(candidate.source_id) || [];
    candidates.push(candidate);
    byId.set(candidate.source_id, candidates);
  }
  return [...byId.entries()]
    .filter(([, candidates]) => candidates.length > 1)
    .map(([sourceId, candidates]) => liveSourceIdFinding(sourceId, candidates));
}

function hashMatches(expected, actual) {
  const expectedText = asText(expected);
  if (!expectedText) return false;
  return expectedText === actual || expectedText.replace(/^sha256:/, '') === actual.replace(/^sha256:/, '');
}

function sourceRecordHashMatches(record, actualHash) {
  if (hashMatches(record.content_hash, actualHash)) return true;
  return (record.hash_history || []).some((entry) => {
    const historicalHash = typeof entry === 'string' ? entry : entry?.content_hash;
    return hashMatches(historicalHash, actualHash);
  });
}

function classifyResult(status, reference, fields = {}) {
  return {
    status,
    reference: typeof reference === 'string' ? { path: reference } : reference,
    ...fields
  };
}

export function buildSourceReference(sourceId, currentPath = null, options = {}) {
  const reference = { source_id: sourceId };
  const pathValue = asText(currentPath || options.path);
  if (pathValue) reference.path = toPortablePath(pathValue);
  if (options.role) reference.role = options.role;
  return reference;
}

export function sourceReferencesForPaths(instanceRoot, paths = [], options = {}) {
  const root = path.resolve(instanceRoot);
  const registry = readRegistryFile(root);
  const references = [];
  const warnings = [];
  for (const item of paths || []) {
    const value = typeof item === 'string' ? { path: item } : item;
    const rawPath = asText(value?.path || value?.current_path || value?.original_path);
    if (!rawPath) continue;
    const relative = workspaceRelativePath(root, rawPath) || toPortablePath(rawPath);
    const absolute = absoluteWorkspacePath(root, rawPath);
    const hasFile = absolute && fs.existsSync(absolute) && fs.statSync(absolute).isFile();
    const fileSourceId = hasFile ? asText(readSourceFrontmatter(absolute).source_id) : '';
    const fileHash = hasFile ? hashSourceFile(absolute) : null;
    const liveCandidates = fileSourceId ? liveSourceIdCandidates(root, fileSourceId, options) : [];
    if (liveCandidates.length > 1) {
      references.push({ source_id: null, path: relative });
      warnings.push({ path: relative, message: 'duplicate-live-source-id' });
      continue;
    }
    let record = fileSourceId
      ? registry.records.find((candidate) => candidate.source_id === fileSourceId)
      : registry.records
        .filter((candidate) => recordMatchesPath(candidate, relative))
        .find((candidate) => !hasFile || sourceRecordHashMatches(candidate, fileHash));

    if (!record) {
      if (absolute && fs.existsSync(absolute) && options.adopt !== false) {
        try {
          const adopted = registerSourceFile(root, absolute, {
            sourceType: options.sourceType || 'local_file',
            channel: options.channel || 'inbox',
            pathReason: 'receipt-adoption'
          });
          if (adopted.ok) {
            record = adopted.record;
            registry.records = loadSourceRegistry(root).records;
          } else {
            warnings.push({ path: relative, message: adopted.reason || 'Source record adoption is ambiguous.' });
          }
        } catch (error) {
          warnings.push({ path: relative, message: error.message });
        }
      }
    }

    if (record) references.push(buildSourceReference(record.source_id, relative));
    else {
      references.push({ source_id: null, path: relative });
      warnings.push({ path: relative, message: 'No source record could be resolved.' });
    }
  }
  return { references, warnings };
}

function updateSourcePathLocked(instanceRoot, sourceId, newPath, options = {}) {
  const root = path.resolve(instanceRoot);
  const registry = readRegistryFile(root);
  const record = findRecordById(registry.records, sourceId);
  if (!record) throw new Error(`Unknown source ID: ${sourceId}`);
  const absolute = absoluteWorkspacePath(root, newPath);
  const contentHash = absolute && fs.existsSync(absolute) ? hashSourceFile(absolute) : null;
  observeRecord(root, record, newPath, {
    observedAt: options.observedAt,
    contentHash,
    pathReason: options.reason || 'moved',
    hashReason: options.hashReason || 'corrected'
  });
  saveSourceRegistry(root, registry, { updatedAt: options.observedAt, locked: true });
  return record;
}
export function updateSourcePath(instanceRoot, sourceId, newPath, options = {}) {
  const root = path.resolve(instanceRoot);
  return withSourceRegistryLock(root, () => updateSourcePathLocked(root, sourceId, newPath, options), options);
}


function syncSourceRecordLocked(instanceRoot, sourceId, options = {}) {
  const root = path.resolve(instanceRoot);
  const registry = readRegistryFile(root);
  const record = findRecordById(registry.records, sourceId);
  if (!record) throw new Error(`Unknown source ID: ${sourceId}`);
  const result = resolveSourceInternal(root, sourceId, { ...options, registry, persist: false, locked: true });
  if (result.status !== 'resolved' && result.status !== 'ambiguous' && record.current_path) {
    const current = absoluteWorkspacePath(root, record.current_path);
    if (current && fs.existsSync(current) && fs.statSync(current).isFile()) {
      const hash = hashSourceFile(current);
      const observed = observeRecord(root, record, current, {
        observedAt: options.observedAt,
        contentHash: hash,
        hashReason: options.reason || 'explicit-sync'
      });
      saveSourceRegistry(root, registry, { updatedAt: options.observedAt, locked: true });
      return {
        status: 'resolved',
        source_id: sourceId,
        path: record.current_path,
        absolute_path: current,
        content_hash: hash,
        hash_changed: observed.hashChanged,
        path_changed: observed.pathChanged,
        explicit_sync: true,
        record
      };
    }
  }
  if (result.status !== 'resolved') return result;
  const absolute = result.absolute_path;
  const hash = hashSourceFile(absolute);
  observeRecord(root, record, absolute, {
    observedAt: options.observedAt,
    contentHash: hash,
    hashReason: options.reason || 'corrected'
  });
  saveSourceRegistry(root, registry, { updatedAt: options.observedAt, locked: true });
  return { ...result, record, content_hash: hash };
}
export function syncSourceRecord(instanceRoot, sourceId, options = {}) {
  const root = path.resolve(instanceRoot);
  return withSourceRegistryLock(root, () => syncSourceRecordLocked(root, sourceId, options), options);
}


function resolveSourceInternal(instanceRoot, sourceId, options = {}) {
  const root = path.resolve(instanceRoot);
  const registry = options.registry || readRegistryFile(root);
  const record = findRecordById(registry.records, sourceId);
  if (!record) return { status: 'unresolved', source_id: sourceId, reason: 'unknown-source-id' };
  const liveCandidates = liveSourceIdCandidates(root, sourceId, options);
  if (liveCandidates.length > 1) {
    const finding = liveSourceIdFinding(sourceId, liveCandidates);
    return {
      status: 'ambiguous',
      source_id: sourceId,
      reason: 'duplicate-live-source-id',
      candidates: liveCandidates.map(({ absolute_path, ...candidate }) => candidate),
      conflict: finding,
      record
    };
  }

  const paths = pathEntries(record);
  const preferredPaths = record.current_path ? [record.current_path] : paths;
  let directCandidates = preferredPaths
    .map((relative) => absoluteWorkspacePath(root, relative))
    .filter((candidate) => candidate && fs.existsSync(candidate) && fs.statSync(candidate).isFile())
    .map((candidate) => candidateForFile(root, candidate));

  if (!directCandidates.length && record.current_path) {
    directCandidates = paths
      .filter((relative) => relative !== record.current_path)
      .map((relative) => absoluteWorkspacePath(root, relative))
      .filter((candidate) => candidate && fs.existsSync(candidate) && fs.statSync(candidate).isFile())
      .map((candidate) => candidateForFile(root, candidate));
  }

  const matchingDirect = directCandidates.filter((candidate) => {
    return candidate.source_id === sourceId || hashMatches(record.content_hash, candidate.content_hash);
  });
  let candidates = matchingDirect;
  const discoveredCandidates = findWorkspaceCandidates(root, options).filter((candidate) => {
    return candidate.source_id === sourceId || hashMatches(record.content_hash, candidate.content_hash);
  });
  const discoveredBySourceId = discoveredCandidates.filter((candidate) => candidate.source_id === sourceId);
  const discoveredByHash = discoveredCandidates.filter((candidate) => hashMatches(record.content_hash, candidate.content_hash));
  if (discoveredBySourceId.length) candidates = discoveredBySourceId;
  else if (discoveredByHash.length) candidates = discoveredByHash;

  if (candidates.length > 1) {
    return {
      status: 'ambiguous',
      source_id: sourceId,
      reason: 'multiple-files-match-source-id-or-content-hash',
      candidates: candidates.map(({ absolute_path, ...candidate }) => candidate),
      record
    };
  }
  if (!candidates.length) {
    return { status: 'unresolved', source_id: sourceId, reason: 'source-file-not-found', record };
  }

  const candidate = candidates[0];
  const observed = observeRecord(root, record, candidate.path, {
    contentHash: candidate.content_hash,
    observedAt: options.observedAt,
    hashReason: 'corrected',
    pathReason: record.current_path ? 'archive-move-detected' : 'resolved-by-content-hash'
  });
  if (options.persist !== false) saveSourceRegistry(root, registry, { updatedAt: options.observedAt, locked: true });
  return {
    status: 'resolved',
    source_id: sourceId,
    path: candidate.path,
    absolute_path: candidate.absolute_path,
    content_hash: candidate.content_hash,
    hash_changed: observed.hashChanged,
    path_changed: observed.pathChanged,
    record
  };
}
export function resolveSource(instanceRoot, sourceId, options = {}) {
  const root = path.resolve(instanceRoot);
  return withSourceRegistryLock(root, () => resolveSourceInternal(root, sourceId, options), options);
}


export function resolveSourceReference(instanceRoot, reference, options = {}) {
  const sourceId = asText(reference?.source_id || reference?.sourceId || reference);
  if (!sourceId) {
    return classifyLegacyPathReference(instanceRoot, reference?.path || reference, options);
  }
  const result = resolveSource(instanceRoot, sourceId, options);
  if (reference?.path && result.status === 'resolved') result.reference_path = toPortablePath(reference.path);
  return result;
}

export function classifyLegacyPathReference(instanceRoot, reference, options = {}) {
  const root = path.resolve(instanceRoot);
  const registry = options.registry || readRegistryFile(root);
  const value = typeof reference === 'string' ? { path: reference } : (reference || {});
  const rawPath = asText(value.path || value.original_path || value.current_path);
  if (!rawPath) return classifyResult('unresolved', value, { reason: 'missing-path' });
  const relative = workspaceRelativePath(root, rawPath) || toPortablePath(rawPath);
  const expectedHash = asText(value.content_hash || value.contentHash || options.contentHash);
  const expectedDate = normalizeDate(value.original_date || value.originalDate || value.date || options.originalDate);
  const matchingRecords = registry.records.filter((record) => recordMatchesPath(record, relative));

  if (matchingRecords.length > 1) {
    return classifyResult('ambiguous', value, {
      reason: 'multiple-source-records-reference-path',
      candidates: matchingRecords.map((record) => buildSourceReference(record.source_id, record.current_path))
    });
  }

  if (matchingRecords.length === 1) {
    const record = matchingRecords[0];
    if (expectedHash && !hashMatches(expectedHash, record.content_hash)) {
      return classifyResult('unresolved', value, {
        reason: 'expected-hash-does-not-match-registered-source',
        candidates: [buildSourceReference(record.source_id, record.current_path)]
      });
    }
    if (expectedDate && record.original_date && expectedDate !== record.original_date) {
      return classifyResult('unresolved', value, {
        reason: 'expected-date-does-not-match-registered-source',
        candidates: [buildSourceReference(record.source_id, record.current_path)]
      });
    }
    const direct = absoluteWorkspacePath(root, relative);
    const isHistoricalPath = record.current_path && record.current_path !== relative;
    if (isHistoricalPath && direct && fs.existsSync(direct) && fs.statSync(direct).isFile()) {
      const candidate = candidateForFile(root, direct);
      const matchesRegisteredSource = candidate.source_id === record.source_id || sourceRecordHashMatches(record, candidate.content_hash);
      if (!matchesRegisteredSource) {
        return classifyResult('unresolved', value, {
          reason: 'historical-path-reused-by-different-file',
          candidates: [candidate, buildSourceReference(record.source_id, record.current_path)]
        });
      }
    }
    return classifyResult('resolved', value, {
      source_id: record.source_id,
      path: record.current_path || relative,
      method: record.current_path === relative ? 'registered-current-path' : 'registered-path-history',
      suggested_reference: buildSourceReference(record.source_id, record.current_path || relative)
    });
  }

  const direct = absoluteWorkspacePath(root, relative);
  if (direct && fs.existsSync(direct) && fs.statSync(direct).isFile()) {
    const candidate = candidateForFile(root, direct);
    if (expectedHash && !hashMatches(expectedHash, candidate.content_hash)) {
      return classifyResult('unresolved', value, {
        reason: 'exact-path-hash-does-not-match-reference',
        candidates: [candidate]
      });
    }
    if (expectedDate && candidate.original_date && expectedDate !== candidate.original_date) {
      return classifyResult('unresolved', value, {
        reason: 'exact-path-date-does-not-match-reference',
        candidates: [candidate]
      });
    }
    return classifyResult('resolved', value, {
      path: relative,
      method: 'exact-path-content-check',
      candidate,
      needs_adoption: true
    });
  }

  const basename = path.basename(relative);
  let candidates = findWorkspaceCandidates(root, options).filter((candidate) => path.basename(candidate.path || '') === basename);
  if (expectedHash) candidates = candidates.filter((candidate) => hashMatches(expectedHash, candidate.content_hash));
  if (expectedDate) candidates = candidates.filter((candidate) => candidate.original_date === expectedDate);

  if (expectedHash && candidates.length === 1) {
    return classifyResult('resolved', value, {
      source_id: candidates[0].source_id,
      path: candidates[0].path,
      method: 'content-hash-and-date-check',
      candidate: candidates[0],
      needs_adoption: !candidates[0].source_id || !registry.records.some((record) => record.source_id === candidates[0].source_id)
    });
  }
  if (candidates.length) {
    return classifyResult('ambiguous', value, {
      reason: expectedHash ? 'multiple-hash-or-date-matches' : 'filename-only-match-is-not-proof',
      human_review: true,
      candidates
    });
  }
  return classifyResult('unresolved', value, {
    reason: expectedHash ? 'no-content-hash-match' : 'no-candidate-file-found',
    human_review: true
  });
}

export function migrateLegacyPathReferences(instanceRoot, references = [], options = {}) {
  const results = [];
  for (const reference of references) {
    const result = classifyLegacyPathReference(instanceRoot, reference, options);
    if (result.status === 'resolved' && options.adopt && (result.needs_adoption || !result.source_id)) {
      const candidatePath = result.path || result.candidate?.path;
      const absolute = candidatePath && absoluteWorkspacePath(instanceRoot, candidatePath);
      if (absolute && fs.existsSync(absolute)) {
        try {
          const adopted = registerSourceFile(instanceRoot, absolute, {
            sourceType: options.sourceType || 'local_file',
            channel: options.channel || 'migration',
            originalDate: reference?.original_date || reference?.originalDate || reference?.date,
            hashReason: 'legacy-adoption',
            pathReason: 'legacy-adoption'
          });
          result.source_id = adopted.record.source_id;
          result.suggested_reference = buildSourceReference(adopted.record.source_id, adopted.record.current_path);
          result.adopted = true;
        } catch (error) {
          result.status = 'unresolved';
          result.reason = `adoption-failed: ${error.message}`;
        }
      }
    }
    results.push(result);
  }
  return {
    results,
    resolved: results.filter((result) => result.status === 'resolved'),
    ambiguous: results.filter((result) => result.status === 'ambiguous'),
    unresolved: results.filter((result) => result.status === 'unresolved')
  };
}

function sourceReferenceKey(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  return `${asText(value.kind || value.type)}:${asText(value.value || value.reference || value.path)}`;
}

function findSourceConflictsFromRegistry(registry) {
  const findings = [];
  const byId = new Map();
  const byHash = new Map();
  const byPath = new Map();
  const byReference = new Map();

  for (const record of registry.records || []) {
    if (!record || !record.source_id) continue;
    const idRecords = byId.get(record.source_id) || [];
    idRecords.push(record);
    byId.set(record.source_id, idRecords);
    if (record.content_hash) {
      const hashRecords = byHash.get(record.content_hash) || [];
      hashRecords.push(record);
      byHash.set(record.content_hash, hashRecords);
    }
    for (const recordPath of new Set(pathEntries(record))) {
      const pathRecords = byPath.get(recordPath) || [];
      pathRecords.push(record);
      byPath.set(recordPath, pathRecords);
    }
    const reference = sourceReferenceKey(record.source_reference);
    if (reference) {
      const referenceRecords = byReference.get(reference) || [];
      referenceRecords.push(record);
      byReference.set(reference, referenceRecords);
    }
  }

  for (const [sourceId, records] of byId) {
    if (records.length > 1) {
      findings.push({
        severity: 'conflict',
        code: 'duplicate-source-id',
        source_ids: [sourceId],
        paths: records.flatMap(pathEntries),
        message: `Source ID ${sourceId} appears in multiple records; preserve both records and resolve ownership manually.`
      });
    }
  }
  for (const [hash, records] of byHash) {
    const ids = [...new Set(records.map((record) => record.source_id))];
    if (ids.length > 1) {
      findings.push({
        severity: 'duplicate',
        code: 'same-content-hash',
        content_hash: hash,
        source_ids: ids,
        paths: records.flatMap(pathEntries),
        message: `Multiple source IDs share content hash ${hash}; review whether these are duplicate references before merging.`
      });
    }
  }
  for (const [recordPath, records] of byPath) {
    const ids = [...new Set(records.map((record) => record.source_id))];
    if (ids.length > 1) {
      findings.push({
        severity: 'conflict',
        code: 'path-has-multiple-source-ids',
        path: recordPath,
        source_ids: ids,
        message: `Path ${recordPath} is claimed by multiple source IDs; do not silently merge or overwrite either record.`
      });
    }
  }
  for (const [reference, records] of byReference) {
    const ids = [...new Set(records.map((record) => record.source_id))];
    if (ids.length > 1) {
      findings.push({
        severity: 'conflict',
        code: 'source-reference-has-multiple-source-ids',
        source_reference: reference,
        source_ids: ids,
        message: `Source reference ${reference} maps to multiple source IDs; request human review.`
      });
    }
  }
  return findings;
}

export function findSourceConflicts(instanceRoot, options = {}) {
  const registry = options.registry || readRegistryFile(instanceRoot);
  const findings = findSourceConflictsFromRegistry(registry);
  findings.push(...findLiveSourceIdConflicts(instanceRoot, options));
  if (options.includeUnregisteredFiles === true) {
    const byHash = new Map();
    for (const candidate of findWorkspaceCandidates(instanceRoot, options)) {
      if (!candidate.content_hash) continue;
      const entries = byHash.get(candidate.content_hash) || [];
      entries.push(candidate);
      byHash.set(candidate.content_hash, entries);
    }
    for (const [hash, candidates] of byHash) {
      if (candidates.length > 1) {
        findings.push({
          severity: 'duplicate',
          code: 'unregistered-same-content-hash',
          content_hash: hash,
          paths: candidates.map((candidate) => candidate.path),
          message: `Multiple files share content hash ${hash}; adopt them separately and review before treating them as one source.`
        });
      }
    }
  }
  return findings;
}

export function extractLegacyPathReferences(content, options = {}) {
  const roots = options.roots || ['0-bootstrap', '1-routing', '2-summaries', '3-indexes', '4-context', '5-evidence', '6-raw', 'governance'];
  const pattern = new RegExp(`(?:${roots.map((root) => root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\/[A-Za-z0-9._~%/@+\\-]+`, 'g');
  return [...new Set(String(content || '').match(pattern) || [])];
}
function isScaffoldGuidanceFile(instanceRoot, filePath, content, options = {}) {
  if (options.includeGuidance === true) return false;
  const relative = workspaceRelativePath(instanceRoot, filePath);
  if (!relative) return false;
  if (relative.startsWith('0-bootstrap/') || relative.startsWith('1-routing/') || relative.startsWith('docs/')) return true;
  if (!SCAFFOLD_GUIDANCE_FILES.has(relative)) return false;
  if (relative === '2-summaries/user-summary.md') return content.includes('Starter summary template');
  if (relative === '4-context/personas.md') return content.includes('_No personas have been synthesised yet._');
  if (relative === '4-context/stakeholders.md') return content.includes('_No stakeholders have been synthesised yet._');
  return true;
}

function isDirectoryLikeReference(reference) {
  const value = String(reference || '');
  if (value.endsWith('/')) return true;
  const normalized = value.replace(/\/+$/, '');
  const basename = path.posix.basename(normalized);
  return ['archive', 'inbox', 'messages', 'new', 'observations', 'processed', 'processing', 'quick-notes', 'signal-clusters', 'source-docs'].includes(basename) &&
    !path.posix.extname(basename);
}


export function discoverLegacyPathReferences(instanceRoot, options = {}) {
  const references = [];
  const seen = new Set();
  options = {
    ...options,
    searchRoots: options.searchRoots || LEGACY_REFERENCE_ROOTS,
    roots: options.roots || LEGACY_REFERENCE_ROOTS
  };
  for (const file of workspaceFiles(instanceRoot, options)) {
    if (!/\.(md|txt|json|ya?ml)$/i.test(file)) continue;
    let content;
    try {
      content = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    if (isScaffoldGuidanceFile(instanceRoot, file, content, options)) continue;
    for (const reference of extractLegacyPathReferences(content, options)) {
      if (isDirectoryLikeReference(reference) || reference === workspaceRelativePath(instanceRoot, file)) continue;
      const key = `${file}\0${reference}`;
      if (seen.has(key)) continue;
      seen.add(key);
      references.push({ path: reference, referenced_in: workspaceRelativePath(instanceRoot, file) });
    }
  }
  return references;
}

export function summarizeSourceFindings(findings = []) {
  return {
    total: findings.length,
    duplicates: findings.filter((finding) => finding.severity === 'duplicate').length,
    conflicts: findings.filter((finding) => finding.severity === 'conflict').length
  };
}
