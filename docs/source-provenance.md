# Source provenance

Mole source records give every captured or imported source an immutable
source_id. A source ID identifies the logical source across archive moves,
sync-folder changes, and content corrections. Paths are useful metadata and
navigation hints; they are never the identity of a source.

## Registry

The workspace registry lives at governance/source-registry.json:

~~~json
{
  "schema_version": 1,
  "registry": "mole-source-registry",
  "updated_at": "2026-09-08T12:00:00.000Z",
  "records": [
    {
      "schema_version": 1,
      "source_id": "src_0f1c...",
      "content_hash": "sha256:...",
      "hash_algorithm": "sha256",
      "source_type": "text_note",
      "original_date": "2026-09-08",
      "captured_at": "2026-09-08T12:00:00.000Z",
      "channel": "slack",
      "source_reference": { "kind": "external", "value": "thread-123" },
      "attachments": [
        {
          "source_id": "src_attachment...",
          "path": "6-raw/inbox/export.csv",
          "name": "export.csv",
          "content_hash": "sha256:...",
          "media_type": "text/csv"
        }
      ],
      "visibility": "internal",
      "retention": {
        "policy": "workspace-default",
        "retain_until": null,
        "legal_hold": false
      },
      "original_path": "6-raw/inbox/20260908T120000000Z-note.md",
      "current_path": "6-raw/archive/2026-09-08/note.md",
      "path_history": [
        {
          "path": "6-raw/inbox/20260908T120000000Z-note.md",
          "observed_at": "2026-09-08T12:00:00.000Z",
          "reason": "captured"
        }
      ],
      "hash_history": [
        {
          "content_hash": "sha256:...",
          "observed_at": "2026-09-08T12:00:00.000Z",
          "reason": "captured"
        }
      ],
      "status": "active"
    }
  ]
}
~~~

## Field glossary

- source_id: generated once for the logical source. Retain it when the source
  moves; never regenerate it from a filename.
- content_hash: SHA-256 hash of source content. Mole excludes the
  self-referential content_hash frontmatter line before hashing.
- source_type: text_note, local_file, synced_file, attachment, imported_export,
  or another explicit source class.
- original_date: date associated with the source as supplied or inferred at
  capture; it is not a replacement for the stable ID.
- captured_at: timestamp at which Mole captured or adopted the source.
- channel: capture or import channel such as slack, chat, file, or import.
- source_reference: external or file reference that helps a human locate the
  origin, for example a conversation ID or export name.
- attachments: child sources with their own IDs and hashes. An attachment is
  not identified only by its display name.
- visibility: access classification for the source.
- retention: retention policy, optional end date, and legal-hold marker.
- original_path: first workspace path observed, when the source is local.
- current_path: latest workspace path observed, when the source is local.
- path_history: prior and observed paths with timestamps and reasons.
- hash_history: hashes observed for the same source ID, including corrections.
- status: lifecycle state such as active, archived, or withdrawn.

External references may have no local path. Local paths are portable
workspace-relative paths; absolute machine paths must not be written into raw
files, evidence, context, or receipts.

## Capture, import, and references

New CLI and UI captures write source_id, content_hash, source metadata, and
attachment descriptors into raw file frontmatter and register the source.
Use the CLI for an existing local file or export:

~~~text
mole sources register 6-raw/inbox/export.csv --source-type imported_export
mole sources import 6-raw/inbox/export.csv --channel import
~~~

Evidence and context should link to a source ID and retain a path only as a
human navigation hint:

~~~yaml
source_references:
  - source_id: src_0f1c...
    path: 6-raw/archive/2026-09-08/note.md
    role: supporting-evidence
~~~

Retrieval receipts should list the source IDs used, the paths observed during
retrieval, and any unresolved or ambiguous references. Receipts retain the
legacy processed path list for compatibility, but source_references is the
authoritative provenance field for new runs.

## Change/outcome compatibility

The source contract is independent of any one planning format and can be
attached to the versioned change/outcome model from issue #11. A normalized
change or outcome record should retain its own change_id or release_id and
carry source_references and evidence_references without copying or replacing
the source records:

~~~yaml
change_id: change_2026_09_08_onboarding
release_id: null
source_references:
  - source_id: src_0f1c...
    role: intent
evidence_references:
  - source_id: src_attachment...
    role: observed-outcome
status: review_due
~~~

Missing intent or outcome fields remain visible as gaps. Provenance does not
justify inventing a baseline, target, result, or confidence value.

## Moves and corrections

When a source moves, keep its source_id, append the old and new paths to
path_history, and update current_path. mole sources sync <source-id> rechecks
the current or archived file.

When content changes, keep the same ID, update content_hash, and append both
the previous and new hashes to hash_history with a reason. A changed hash is
an audit event, not permission to silently create a second source or merge two
records.

The resolver first uses source ID and then verifies the content hash. If a
source ID or hash matches multiple files, resolution is ambiguous and the
files remain separate until a human decides. A missing source is unresolved.

## Migrating path-only references

mole sources migrate is report-only. It scans references in workspace
markdown, text, JSON, and YAML files and classifies each reference as:

- resolved: exact path, registered path history, or a unique hash/date match;
  the report may suggest a source-ID reference.
- ambiguous: filename-only or multiple candidate match. Filename matching is
  never proof of identity.
- unresolved: no candidate or a hash/date mismatch.

mole sources migrate --write adopts exact-path and hash-verified candidates
into the registry. It does not rewrite raw source files or reference text, so
the migration is reversible and existing workspace content remains intact.
Review every ambiguous and unresolved result before adding a source ID.

## Duplicate and conflict findings

mole sources audit reports duplicate content hashes, duplicate source IDs,
paths claimed by multiple IDs, and external references claimed by multiple IDs.
Findings include severity, code, paths/IDs, and an action message. The registry
never silently merges records; preserve both records and resolve ownership or
deduplication explicitly.
