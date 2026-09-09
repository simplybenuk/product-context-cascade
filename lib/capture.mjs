import { randomBytes } from 'node:crypto';
import { addContentHash, createSourceId } from './source-registry.mjs';

export { addContentHash, createSourceId };

export function slugifyCapture(input, fallback = 'note') {
  return String(input || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50) || fallback;
}

export function formatUtcTimestamp(date = new Date()) {
  return date.toISOString().replace(/[-:.]/g, '').replace('T', 'T');
}

export function createUniqueSuffix() {
  return randomBytes(4).toString('hex');
}

export function createCaptureFileName(input, options = {}) {
  const now = options.now || new Date();
  const uniqueSuffix = options.uniqueSuffix || createUniqueSuffix();
  return `${formatUtcTimestamp(now)}-${slugifyCapture(input)}-${uniqueSuffix}.md`;
}

export function resolveCapturedBy(explicitValue, env = process.env, fallback = 'unknown') {
  const explicit = String(explicitValue || '').trim();
  if (explicit) return explicit;

  return env.MOLE_CAPTURED_BY?.trim() || env.USER?.trim() || env.USERNAME?.trim() || fallback;
}

export function createCaptureProvenance(options = {}) {
  const capturedAt = options.capturedAt || options.captured_at || options.createdAt || new Date().toISOString();
  return {
    sourceId: createSourceId({ sourceId: options.sourceId || options.source_id }),
    sourceType: options.sourceType || options.source_type || 'text_note',
    originalDate: options.originalDate || options.original_date || capturedAt.slice(0, 10),
    capturedAt,
    channel: options.channel || 'capture',
    sourceReference: options.sourceReference || options.source_reference || null,
    attachments: Array.isArray(options.attachments) ? options.attachments : [],
    visibility: options.visibility || 'internal',
    retention: options.retention || options.retention_metadata || {
      policy: 'workspace-default',
      retain_until: null,
      legal_hold: false
    }
  };
}
