# Run Receipts

Store retrieval receipts/logs for significant generated outputs.
Suggested filename: `YYYY-MM-DD-<task-slug>.md`

Inbox processing receipts live under `inbox-processing/` as JSON. Each current receipt is keyed by `run_id` and records the processor, host, lease timestamps, claimed paths, processed paths, unresolved paths, summary, and a lock snapshot. Retried completion with the same run ID must return that receipt instead of creating another one.

Stale-lock and missing-lock decisions live under `inbox-processing/overrides/`. An override records the actor, host, time, reason, replacement run, and replaced lock. Keep these records available for audit. They are not permission to discard source files or silently resolve sync conflicts.
