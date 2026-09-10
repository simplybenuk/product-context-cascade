# Run Receipts

Store retrieval receipts/logs for significant generated outputs.
Suggested filename: `YYYY-MM-DD-<task-slug>.md`

Inbox processing receipts live under `inbox-processing/` as JSON. Each current receipt is keyed by `run_id` and records the processor, host, lease timestamps, claimed paths, processed paths, unresolved paths, summary, and a lock snapshot. Retried completion with the same run ID must return that receipt instead of creating another one.

Stale-lock and missing-lock decisions live under `inbox-processing/overrides/`. An override records the actor, host, time, reason, replacement run, and replaced lock. Keep these records available for audit. They are not permission to discard source files or silently resolve sync conflicts.

Receipts from different run IDs must not claim the same canonical inbox path. `mole inbox audit` reports that split-brain state and excludes the path from the normal processed set; metrics backfill skips it until the receipts are reconciled. Duplicate receipts for one run exclude the full union of their processed paths, including paths present in only one copy.

Every accepted receipt requires a nonempty string identity (`run_id`, legacy `lock_id`, or legacy `receipt_id`) and a valid string `completed_at` timestamp. A supplied `status` must be `completed`. Audit and metrics backfill use the same validated receipt snapshot and exclude invalid records and conflict-named receipt files.

Malformed override JSON, conflict-named override copies, and duplicate `override_id` values block processing. Preserve all copies and reconcile the audit history before retrying. Expired legacy locks are migrated only through an explicit audited stale-lock override; normal completion does not silently upgrade them.

Stale recovery checks every inherited claim, inherited checkpoint, and requested claim against existing completion receipts. If any canonical path is already covered, it returns `ALREADY_PROCESSED` without replacing the lock or writing an override. Reconcile the stale lock and receipt history before retrying; requesting a different claim does not discard inherited checkpoints.

Lock checkpoint arrays must contain canonical relative string paths. Damaged entries cause `INVALID_LOCK` before any mutation; repair them from retained evidence instead of allowing normalization to discard them.

Completion releases a lock by atomically moving it to a unique file and checking that snapshot before deletion. If the moved lock differs from the expected state, Mole restores it without overwriting an arriving lock. If restoration fails, it keeps a conflict-named copy under `governance/` for audit and reconciliation. If a receipt arrives during its exclusive write, completion accepts it only when all fields match the expected receipt. An identical receipt still completes lock release and override finalization.

The local mutation mutex publishes one unique contender record per operation before checking other contenders. It never moves or removes another operation's record, so recovery does not open a gap for a third mutation. Each record includes a token and process identity. Linux uses the boot ID and process start ticks; other Unix systems use the process start time reported by `ps`. A live matching process retains its mutex. Dead or replaced processes can be ignored immediately. Empty, truncated, legacy, or otherwise unverifiable mutex records become recoverable after five minutes without modification, with acquisition age also checked when available. This fallback also applies on Windows. A mutation still running in the current process is never ignored by another call in that process.

## Interrupted recovery

Overrides start in `prepared` state and become `finalized` only after the lock replacement or completion receipt is written. Audit reports `INCOMPLETE_OVERRIDE` while any prepared record remains.

If a missing-lock completion wrote its receipt but could not finalize its override, retry completion with the same run ID, processor, and host recorded in the receipt:

```bash
mole inbox complete --run-id <run-id> --processor "Your Name" --host <original-host>
mole inbox audit
```

The retry returns the existing receipt without changing it and finalizes only the matching prepared override. It does not bypass unrelated prepared records or conflicting copies. Check that audit no longer reports `INCOMPLETE_OVERRIDE` for that record.

If no receipt exists, or a stale-lock override remains prepared, there is no automatic finalization path. Pause processing and reconcile the lock, receipts, override records, and sync history manually. Retain the original records as evidence; a prepared record alone does not prove that recovery succeeded.
