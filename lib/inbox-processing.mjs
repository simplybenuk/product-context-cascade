import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { formatUtcTimestamp, resolveCapturedBy } from './capture.mjs';
import { sourceReferencesForPaths } from './source-registry.mjs';

const LOCK_REL_PATH = path.join('governance', 'inbox-processing.lock.json');
const RECEIPTS_REL_DIR = path.join('governance', 'run-receipts', 'inbox-processing');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readJsonIfExists(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

export function getInboxProcessingPaths(instanceRoot) {
  return {
    lockPath: path.join(instanceRoot, LOCK_REL_PATH),
    lockRelPath: LOCK_REL_PATH,
    receiptsDir: path.join(instanceRoot, RECEIPTS_REL_DIR),
    receiptsRelDir: RECEIPTS_REL_DIR
  };
}

export function claimInboxProcessing(instanceRoot, options = {}) {
  const { lockPath, lockRelPath } = getInboxProcessingPaths(instanceRoot);
  const now = options.now || new Date();
  const lock = {
    lock_id: options.lockId || randomBytes(6).toString('hex'),
    status: 'processing',
    claimed_by: resolveCapturedBy(options.claimedBy),
    started_at: now.toISOString(),
    stale_after: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(),
    inbox: '6-raw/inbox'
  };

  ensureDir(path.dirname(lockPath));

  try {
    fs.writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;

    const existing = readJsonIfExists(lockPath);
    const owner = existing?.claimed_by || 'another processor';
    const startedAt = existing?.started_at ? ` at ${existing.started_at}` : '';
    const staleAfter = existing?.stale_after ? ` Stale after ${existing.stale_after}.` : '';
    return {
      ok: false,
      lock: existing,
      lockPath: lockRelPath,
      message: `Inbox processing already claimed by ${owner}${startedAt}.${staleAfter}`
    };
  }

  return {
    ok: true,
    lock,
    lockPath: lockRelPath,
    message: `Inbox processing claimed by ${lock.claimed_by}.`
  };
}

export function completeInboxProcessing(instanceRoot, options = {}) {
  const { lockPath, lockRelPath, receiptsDir, receiptsRelDir } = getInboxProcessingPaths(instanceRoot);
  const lock = readJsonIfExists(lockPath);

  if (!lock) {
    if (!options.allowMissingLock) {
      return {
        ok: false,
        lockPath: lockRelPath,
        message: 'No inbox processing lock exists.'
      };
    }
  }

  const completedAt = options.completedAt || new Date();
  let sourceReferences = options.sourceReferences || [];
  let provenanceWarnings = [];
  if (!options.sourceReferences) {
    try {
      const resolved = sourceReferencesForPaths(instanceRoot, options.processed || [], {
        adopt: options.adoptSources !== false,
        channel: 'inbox'
      });
      sourceReferences = resolved.references;
      provenanceWarnings = resolved.warnings;
    } catch (error) {
      provenanceWarnings = [{ message: error.message }];
    }
  }
  const lockId = lock?.lock_id || options.lockId || `unclaimed-${randomBytes(6).toString('hex')}`;
  const receipt = {
    receipt_id: `${formatUtcTimestamp(completedAt)}-${lockId}`,
    lock_id: lockId,
    claimed_by: lock?.claimed_by || resolveCapturedBy(options.claimedBy),
    started_at: lock?.started_at || options.startedAt || completedAt.toISOString(),
    completed_at: completedAt.toISOString(),
    processed: options.processed || [],
    source_references: sourceReferences,
    summary: options.summary || 'Inbox processing completed.'
  };
  if (provenanceWarnings.length) receipt.provenance_warnings = provenanceWarnings;
  const receiptFile = `${receipt.receipt_id}.json`;
  const receiptPath = path.join(receiptsDir, receiptFile);
  const receiptRelPath = path.join(receiptsRelDir, receiptFile);

  ensureDir(receiptsDir);
  fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  if (lock) fs.unlinkSync(lockPath);

  return {
    ok: true,
    receipt,
    receiptPath: receiptRelPath,
    message: `Inbox processing receipt written to ${receiptRelPath}.`
  };
}
