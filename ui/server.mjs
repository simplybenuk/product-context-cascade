import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCaptureFileName, resolveCapturedBy, createCaptureProvenance, addContentHash } from '../lib/capture.mjs';
import { createSourceId, registerSourceFile } from '../lib/source-registry.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(__dirname, 'public');
const PORT = process.env.PORT || 4173;
const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === __filename;

const allowedRoots = new Set([
  '0-bootstrap',
  '1-routing',
  '2-summaries',
  '3-indexes',
  '4-context',
  '5-evidence',
  '6-raw',
  'governance',
  'docs',
  'README.md',
]);

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

function send(res, code, body, contentType = 'application/json; charset=utf-8') {
  res.writeHead(code, { 'content-type': contentType });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function safeRepoPath(input = '') {
  const normalized = input.replace(/^\/+/, '');
  const resolved = path.resolve(REPO_ROOT, normalized);
  if (!resolved.startsWith(REPO_ROOT)) throw new Error('Invalid path');
  const rel = path.relative(REPO_ROOT, resolved);
  const top = rel.split(path.sep)[0];
  if (!allowedRoots.has(top) && rel !== 'README.md') {
    throw new Error('Path outside allowed roots');
  }
  return { resolved, rel };
}

async function listDir(targetPath) {
  const entries = await fs.readdir(targetPath, { withFileTypes: true });
  const out = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name.startsWith('.git')) continue;
    out.push({ name: entry.name, type: entry.isDirectory() ? 'dir' : 'file' });
  }
  return out;
}

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

export function createCaptureRelPath(type, note, options = {}) {
  const filename = createCaptureFileName(String(note || '').split('\n')[0], options);
  return path.join('6-raw', 'inbox', filename);
}

export function buildUiCaptureContent(body, options = {}) {
  const date = options.date || todayDate();
  const source = body.source || 'self';
  const channel = body.channel || 'chat';
  const confidence = body.confidence || 'low';
  const tags = Array.isArray(body.tags) ? body.tags : [];
  const capturedBy = resolveCapturedBy(body.capturedBy || body.captured_by);
  const note = (body.note || '').trim();
  const capturedAt = options.capturedAt || options.captured_at || `${date}T00:00:00.000Z`;
  const provenance = createCaptureProvenance({
    sourceId: options.sourceId || body.sourceId || body.source_id || createSourceId(),
    sourceType: options.sourceType || body.sourceType || body.source_type || 'text_note',
    originalDate: options.originalDate || body.originalDate || body.original_date || date,
    capturedAt,
    channel,
    sourceReference: options.sourceReference || body.sourceReference || body.source_reference,
    attachments: options.attachments || body.attachments,
    visibility: options.visibility || body.visibility || 'internal',
    retention: options.retention || body.retention
  });

  return addContentHash([
    '---',
    `date: ${date}`,
    `source: ${source}`,
    `source_id: ${provenance.sourceId}`,
    `source_type: ${provenance.sourceType}`,
    `original_date: ${provenance.originalDate}`,
    `captured_at: ${provenance.capturedAt}`,
    `captured_by: ${capturedBy}`,
    `channel: ${channel}`,
    `topic_tags: [${tags.join(', ')}]`,
    `confidence: ${confidence}`,
    `source_reference: ${JSON.stringify(provenance.sourceReference)}`,
    `attachments: ${JSON.stringify(provenance.attachments)}`,
    `visibility: ${provenance.visibility}`,
    `retention: ${JSON.stringify(provenance.retention)}`,
    '---',
    '',
    note,
    '',
  ].join('\n'));
}
async function routeApi(req, res, urlObj) {
  if (req.method === 'GET' && urlObj.pathname === '/api/tree') {
    const p = urlObj.searchParams.get('path') || '';
    const { resolved, rel } = safeRepoPath(p || 'README.md');
    let stat;
    try {
      stat = await fs.stat(resolved);
    } catch {
      return send(res, 404, { error: 'Not found' });
    }
    if (stat.isFile()) {
      return send(res, 200, { path: rel, type: 'file' });
    }
    const entries = await listDir(resolved);
    return send(res, 200, { path: rel || '.', type: 'dir', entries });
  }

  if (req.method === 'GET' && urlObj.pathname === '/api/file') {
    const p = urlObj.searchParams.get('path');
    if (!p) return send(res, 400, { error: 'Missing path' });
    const { resolved, rel } = safeRepoPath(p);
    const stat = await fs.stat(resolved).catch(() => null);
    if (!stat || !stat.isFile()) return send(res, 404, { error: 'File not found' });
    const content = await fs.readFile(resolved, 'utf8');
    return send(res, 200, { path: rel, content });
  }

  if (req.method === 'POST' && urlObj.pathname === '/api/capture') {
    const body = await readBody(req);
    const type = body.type || 'quick-notes';
    const source = body.source || 'self';
    const channel = body.channel || 'chat';
    const confidence = body.confidence || 'low';
    const tags = Array.isArray(body.tags) ? body.tags : [];
    const note = (body.note || '').trim();
    if (!note) return send(res, 400, { error: 'Note is required' });

    const date = todayDate();
    const relPath = createCaptureRelPath(type, note);
    const capturedAt = new Date().toISOString();
    const sourceId = createSourceId();
    const sourceReference = { kind: 'file', value: relPath };
    const { resolved } = safeRepoPath(relPath);

    const frontmatter = buildUiCaptureContent({
      source,
      channel,
      confidence,
      tags,
      note,
      capturedBy: body.capturedBy || body.captured_by
    }, {
      date,
      capturedAt,
      sourceId,
      sourceType: body.sourceType || body.source_type || 'text_note',
      originalDate: body.originalDate || body.original_date || date,
      sourceReference,
      attachments: body.attachments,
      visibility: body.visibility,
      retention: body.retention
    });

    await fs.mkdir(path.dirname(resolved), { recursive: true });
    try {
      await fs.writeFile(resolved, frontmatter, { encoding: 'utf8', flag: 'wx' });
    } catch (err) {
      if (err.code === 'EEXIST') {
        return send(res, 409, { error: 'Capture already exists; retry to generate a new filename.' });
      }
      throw err;
    }

    let sourceRecord;
    let provenanceWarning;
    try {
      sourceRecord = registerSourceFile(REPO_ROOT, resolved, {
        sourceId,
        sourceType: body.sourceType || body.source_type || 'text_note',
        originalDate: body.originalDate || body.original_date || date,
        capturedAt,
        channel,
        sourceReference,
        attachments: body.attachments,
        visibility: body.visibility,
        retention: body.retention,
        hashReason: 'captured'
      });
    } catch (error) {
      provenanceWarning = error.message;
    }
    if (sourceRecord?.ok === false) {
      provenanceWarning = sourceRecord.reason || 'duplicate-live-source-id';
    }

    return send(res, 200, {
      ok: true,
      path: relPath,
      source_id: sourceRecord?.record?.source_id || sourceId,
      content_hash: sourceRecord?.record?.content_hash || null,
      provenance_warning: provenanceWarning || undefined
    });
  }

  return false;
}

const server = http.createServer(async (req, res) => {
  try {
    const urlObj = new URL(req.url, `http://${req.headers.host}`);
    if (urlObj.pathname.startsWith('/api/')) {
      const handled = await routeApi(req, res, urlObj);
      if (handled !== false) return;
      return send(res, 404, { error: 'API route not found' });
    }

    let filePath = urlObj.pathname === '/' ? '/index.html' : urlObj.pathname;
    filePath = path.join(PUBLIC_DIR, filePath);
    const stat = await fs.stat(filePath).catch(() => null);
    if (!stat || !stat.isFile()) return send(res, 404, 'Not found', 'text/plain; charset=utf-8');
    const ext = path.extname(filePath);
    const contentType = mime[ext] || 'application/octet-stream';
    const content = await fs.readFile(filePath);
    return send(res, 200, content, contentType);
  } catch (err) {
    return send(res, 500, { error: err.message || 'Server error' });
  }
});

if (isDirectRun) {
  server.listen(PORT, () => {
    console.log(`Context Cascade UI running on http://localhost:${PORT}`);
  });
}
