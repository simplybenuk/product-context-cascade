# Agents - Mole

Read order (always):
1. `0-bootstrap/agents.md`
2. `1-routing/task-types.md`
3. smallest relevant summaries/indexes
4. context modules only as needed
5. evidence/raw only when required

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
- In shared inboxes, claim one run before processing with `mole inbox claim "Your Name"`. The JSON lock carries a `run_id`, processor, host, heartbeat, expiry, claimed paths, and checkpointed paths. Locks reduce overlap on local files but are not a perfect distributed lock under sync delay.
- Keep the returned `run_id` and use `mole inbox heartbeat` while a long run is active. Use `mole inbox checkpoint --processed <path>` after each safely promoted item so a restart can resume without reprocessing checkpointed paths.
- After promoting an inbox artefact, update relevant indexes and summaries, write a retrieval receipt, and only then remove or archive the inbox copy.
- Complete only with the active owned run: `mole inbox complete --run-id <run-id> --processor "Your Name" --processed <path> ... "summary"`. Missing, expired, foreign, duplicate, or conflicted state must fail closed. Use `mole inbox override-stale` or `--override-missing-lock --reason "..."` only after checking sync history and record the decision.
- Never delete or move a source file to resolve a sync conflict. Preserve every copy, report the paths, and resolve the source decision explicitly before processing.
- During inbox synthesis, treat user/persona-relevant signals as candidates for `4-context/personas.md`; update an existing persona or create a new one when the evidence indicates a durable user type.
- End substantive outputs with a retrieval receipt.
