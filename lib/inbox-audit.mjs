import fs from 'node:fs';
import path from 'node:path';
import { inspectInboxProcessing, looksLikeSyncConflictName } from './inbox-processing.mjs';

const REQUIRED_ROOTS = [
  'mole.instance.yaml',
  '0-bootstrap',
  '1-routing',
  '2-summaries',
  '3-indexes',
  '4-context',
  '5-evidence',
  '6-raw',
  path.join('6-raw', 'inbox')
];

function toPortablePath(value) {
  return value.split(path.sep).join('/');
}

function canonicalizeInboxPath(instanceRoot, value) {
  const text = String(value || '').trim();
  if (!text) return '';
  const absolute = path.isAbsolute(text) ? text : path.resolve(instanceRoot, text);
  return toPortablePath(path.relative(instanceRoot, path.normalize(absolute)));
}

function assertMoleWorkspaceRoot(instanceRoot) {
  const root = path.resolve(instanceRoot);
  const missing = REQUIRED_ROOTS.filter((relative) => !fs.existsSync(path.join(root, relative)));
  if (missing.length) {
    throw new Error(
      'Path is not a Mole workspace root: ' + root + '. Missing: ' + missing.join(', ')
    );
  }
  return root;
}

function walkInbox(root, current, files, conflicts) {
  for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name === 'archive') continue;
    const absolute = path.join(current, entry.name);
    if (entry.isDirectory()) {
      walkInbox(root, absolute, files, conflicts);
    } else if (entry.isFile()) {
      const relative = toPortablePath(path.relative(root, absolute));
      if (relative === '6-raw/inbox/README.md') continue;
      files.push(relative);
      if (looksLikeSyncConflictName(entry.name)) conflicts.push(relative);
    }
  }
}

export function discoverInboxFiles(instanceRoot) {
  const root = path.resolve(instanceRoot);
  const inbox = path.join(root, '6-raw', 'inbox');
  if (!fs.existsSync(inbox)) throw new Error('Inbox directory does not exist: ' + inbox);
  const files = [];
  walkInbox(root, inbox, files, []);
  return files.sort((left, right) => left.localeCompare(right));
}

export function discoverInboxConflictFiles(instanceRoot) {
  const root = path.resolve(instanceRoot);
  const inbox = path.join(root, '6-raw', 'inbox');
  if (!fs.existsSync(inbox)) throw new Error('Inbox directory does not exist: ' + inbox);
  const conflicts = [];
  walkInbox(root, inbox, [], conflicts);
  return conflicts.sort((left, right) => left.localeCompare(right));
}

function readProcessedPaths(processingState, instanceRoot) {
  const processed = new Set();
  const conflicted = new Set((processingState.processedPathConflicts || [])
    .map((item) => item.path));
  for (const record of processingState.receipts) {
    for (const item of record.receipt.processed || []) {
      const canonical = canonicalizeInboxPath(instanceRoot, item);
      if (canonical && !conflicted.has(canonical)) processed.add(canonical);
    }
  }
  return processed;
}

function expiryDate(lock) {
  const value = lock?.expires_at || lock?.stale_after;
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function auditInbox(instanceRoot, options = {}) {
  const root = assertMoleWorkspaceRoot(instanceRoot);
  const candidates = discoverInboxFiles(root);
  const syncConflictFiles = discoverInboxConflictFiles(root);
  const processing = inspectInboxProcessing(root);
  const processedPaths = readProcessedPaths(processing, root);
  const processed = candidates.filter((item) => processedPaths.has(item));
  const unprocessed = candidates.filter((item) => !processedPaths.has(item));
  const now = options.now ? new Date(options.now) : new Date();
  const expiry = expiryDate(processing.lock);
  const staleLock = processing.lock && !processing.lockValidationError && expiry
    && now.getTime() >= expiry.getTime()
    ? processing.lock
    : null;
  const issues = [];

  if (processing.lockError || processing.lockValidationError) {
    issues.push({
      code: 'INVALID_LOCK',
      paths: [processing.lockPath],
      message: processing.lockError || processing.lockValidationError
    });
  }
  if (processing.conflictLockPaths.length) {
    issues.push({
      code: 'SYNC_CONFLICT',
      paths: processing.conflictLockPaths,
      message: 'Conflicting inbox lock copies exist.'
    });
  }
  if (syncConflictFiles.length) {
    issues.push({
      code: 'SYNC_CONFLICT',
      paths: syncConflictFiles,
      message: 'Conflicting inbox source copies exist. Preserve every copy.'
    });
  }
  if (processing.conflictReceipts.length) {
    issues.push({
      code: 'SYNC_CONFLICT',
      paths: processing.conflictReceipts.map((item) => item.path),
      message: 'Conflicting receipt copies exist.'
    });
  }
  if (processing.duplicateReceipts.length) {
    issues.push({
      code: 'DUPLICATE_RECEIPT',
      paths: processing.duplicateReceipts.flatMap((item) => item.paths),
      message: 'More than one receipt claims the same run.'
    });
  }
  if (processing.invalidReceipts.length) {
    issues.push({
      code: 'INVALID_RECEIPT',
      paths: processing.invalidReceipts.map((item) => item.path),
      message: 'One or more processing receipts cannot be validated.'
    });
  }
  if (processing.invalidOverrides?.length) {
    issues.push({
      code: 'INVALID_OVERRIDE',
      paths: processing.invalidOverrides.map((item) => item.path),
      message: 'One or more inbox-processing override records cannot be validated.'
    });
  }
  if (processing.incompleteOverrides?.length) {
    issues.push({
      code: 'INCOMPLETE_OVERRIDE',
      paths: processing.incompleteOverrides.map((item) => item.path),
      message: 'One or more stale-lock override records were prepared but not finalized. Reconcile the lock replacement before continuing.'
    });
  }
  if (processing.processedPathConflicts?.length) {
    issues.push({
      code: 'PROCESSED_PATH_CONFLICT',
      paths: processing.processedPathConflicts.map((item) => item.path),
      message: 'More than one run receipt claims the same canonical inbox path. Preserve the receipts and reconcile the split-brain state before counting or reprocessing it.'
    });
  }
  if (staleLock) {
    issues.push({
      code: 'STALE_LOCK',
      paths: [processing.lockPath],
      message: 'The active inbox lease has expired and needs an explicit recovery decision.'
    });
  }

  return {
    workspaceRoot: root,
    candidates,
    processed,
    unprocessed,
    processedPaths: [...processedPaths].sort((left, right) => left.localeCompare(right)),
    activeLock: processing.lock && !staleLock ? processing.lock : null,
    staleLock,
    syncConflictFiles,
    conflictLockPaths: processing.conflictLockPaths,
    conflictReceipts: processing.conflictReceipts,
    duplicateReceipts: processing.duplicateReceipts,
    invalidReceipts: processing.invalidReceipts,
    invalidOverrides: processing.invalidOverrides || [],
    incompleteOverrides: processing.incompleteOverrides || [],
    processedPathConflicts: processing.processedPathConflicts || [],
    overrides: processing.overrides,
    issues,
    ok: unprocessed.length === 0 && issues.length === 0
  };
}
