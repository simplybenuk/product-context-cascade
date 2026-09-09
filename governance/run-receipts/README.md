# Run Receipts

Store retrieval receipts/logs for significant generated outputs.
Suggested filename: `YYYY-MM-DD-<task-slug>.md`

Inbox processing receipts live under `inbox-processing/` as JSON. Each current receipt is keyed by `run_id` and records the processor, host, lease timestamps, claimed paths, processed paths, unresolved paths, summary, and a lock snapshot. Retried completion with the same run ID must return that receipt instead of creating another one.

Stale-lock and missing-lock decisions live under `inbox-processing/overrides/`. An override records the actor, host, time, reason, replacement run, and replaced lock. Keep these records available for audit. They are not permission to discard source files or silently resolve sync conflicts.

Receipts from different run IDs must not claim the same canonical inbox path. `mole inbox audit` reports that split-brain state and excludes the path from the normal processed set; metrics backfill skips it until the receipts are reconciled. Duplicate receipts for one run exclude the full union of their processed paths, including paths present in only one copy.

Every accepted receipt requires a nonempty string identity (`run_id`, legacy `lock_id`, or legacy `receipt_id`) and a valid string `completed_at` timestamp. A supplied `status` must be `completed`. Audit and metrics backfill use the same validated receipt snapshot and exclude invalid records and conflict-named receipt files.

Malformed override JSON, conflict-named override copies, and duplicate `override_id` values block processing. Preserve all copies and reconcile the audit history before retrying. Expired legacy locks are migrated only through an explicit audited stale-lock override; normal completion does not silently upgrade them.

## Interrupted recovery

Overrides start in `prepared` state and become `finalized` only after the lock replacement or completion receipt is written. Audit reports `INCOMPLETE_OVERRIDE` while any prepared record remains.

If a missing-lock completion wrote its receipt but could not finalize its override, retry completion with the same run ID, processor, and host recorded in the receipt:

```bash
mole inbox complete --run-id <run-id> --processor "Your Name" --host <original-host>
mole inbox audit
```

The retry returns the existing receipt without changing it and finalizes only the matching prepared override. It does not bypass unrelated prepared records or conflicting copies. Check that audit no longer reports `INCOMPLETE_OVERRIDE` for that record.

If no receipt exists, or a stale-lock override remains prepared, there is no automatic finalization path. Pause processing and reconcile the lock, receipts, override records, and sync history manually. Retain the original records as evidence; a prepared record alone does not prove that recovery succeeded.
