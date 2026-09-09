import fs from 'node:fs';
import path from 'node:path';
import { readSourceFrontmatter } from './source-registry.mjs';

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
    throw new Error(`Path is not a Mole workspace root: ${root}. Missing: ${missing.join(', ')}`);
  }
  return root;
}

function walkInbox(root, current, files) {
  for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name === 'archive') continue;
    const absolute = path.join(current, entry.name);
    if (entry.isDirectory()) {
      walkInbox(root, absolute, files);
    } else if (entry.isFile()) {
      const relative = toPortablePath(path.relative(root, absolute));
      if (relative === '6-raw/inbox/README.md') continue;
      files.push(relative);
    }
  }
}

export function discoverInboxFiles(instanceRoot) {
  const root = path.resolve(instanceRoot);
  const inbox = path.join(root, '6-raw', 'inbox');
  if (!fs.existsSync(inbox)) throw new Error(`Inbox directory does not exist: ${inbox}`);
  const files = [];
  walkInbox(root, inbox, files);
  return files.sort((left, right) => left.localeCompare(right));
}

function readProcessedSources(instanceRoot) {
  const receiptsDir = path.join(instanceRoot, 'governance', 'run-receipts', 'inbox-processing');
  if (!fs.existsSync(receiptsDir)) return { paths: new Set(), sourceIds: new Set() };

  const paths = new Set();
  const sourceIds = new Set();
  for (const entry of fs.readdirSync(receiptsDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const receipt = JSON.parse(fs.readFileSync(path.join(receiptsDir, entry.name), 'utf8'));
    for (const item of receipt.processed || []) {
      const canonical = canonicalizeInboxPath(instanceRoot, item);
      if (canonical) paths.add(canonical);
    }
    for (const reference of receipt.source_references || []) {
      const sourceId = String(reference?.source_id || reference?.sourceId || '').trim();
      if (sourceId) sourceIds.add(sourceId);
      const canonical = canonicalizeInboxPath(instanceRoot, reference?.path);
      if (canonical) paths.add(canonical);
    }
  }
  return { paths, sourceIds };
}

export function auditInbox(instanceRoot) {
  const root = assertMoleWorkspaceRoot(instanceRoot);
  const candidates = discoverInboxFiles(root);
  const processedSources = readProcessedSources(root);
  const isProcessed = (item) => {
    const sourceId = readSourceFrontmatter(path.join(root, item)).source_id;
    return processedSources.paths.has(item) || (sourceId && processedSources.sourceIds.has(sourceId));
  };
  const processed = candidates.filter(isProcessed);
  const unprocessed = candidates.filter((item) => !isProcessed(item));

  return {
    workspaceRoot: root,
    candidates,
    processed,
    unprocessed
  };
}
