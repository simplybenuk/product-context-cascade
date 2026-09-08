# Agents - Mole

Read order (always):
1. `0-bootstrap/agents.md`
2. `1-routing/task-types.md`
3. smallest relevant summaries/indexes
4. context modules only as needed
5. evidence/raw only when required

Stable provenance:
- Treat source IDs as the identity of captures, local files, synced files,
  attachments, and imported exports.
- Use source_references with source_id in evidence, context, and retrieval
  receipts. Keep workspace-relative paths only as navigation hints.
- Preserve the same source ID across archive moves. Record path history and
  verify content hashes after moves or corrections.
- Never infer identity from a filename alone. Classify uncertain legacy
  references as ambiguous or unresolved and request human review.
- Do not silently merge duplicate or conflicting records.

Rules:
- Prefer summaries before source docs.
- Respect depth budgets.
- Stop at sufficiency.
- When the inbox contains a substantive artefact such as a PDF, spreadsheet, slide deck, export, or transcript, treat it as a source document rather than a weak signal.
- Promote substantive artefacts to `5-evidence/source-docs/` first, then create `4-context/` modules only when synthesis adds durable value.
- Only route inbox snippets to `5-evidence/signal-clusters/` when the input is primarily a set of weak signals or messy notes.
- If blocked by missing human input, add an item to `governance/input-queue.md`.
- Treat direct files in `6-raw/inbox/` as the current flat drop zone. In upgraded workspaces, also treat legacy subfolders such as `quick-notes/`, `messages/`, `observations/`, and `new/` as unprocessed input.
- Before inbox synthesis, validate the workspace with `mole doctor` and run `mole inbox audit`; the audit is recursive and identifies live files not covered by processing receipts. Run it again before completion and never report a no-op while unexplained files remain.
- In shared inboxes, claim `governance/inbox-processing.lock.json` before processing when coordination is needed. Locks prevent overlap; JSON receipts are the durable processing record.
- After promoting an inbox artefact, update relevant indexes and summaries, write a retrieval receipt, and only then remove or archive the inbox copy.
- When completing inbox processing, run `mole inbox complete --processed <path> ... "summary"` and include only inbox items that were actually processed. Do not count skipped items, inspected-only items, or raw content in metrics files.
- During inbox synthesis, treat user/persona-relevant signals as candidates for `4-context/personas.md`; update an existing persona or create a new one when the evidence indicates a durable user type.
- End substantive outputs with a retrieval receipt.
