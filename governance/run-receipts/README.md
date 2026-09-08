# Run Receipts

Store retrieval receipts/logs for significant generated outputs.
Suggested filename: YYYY-MM-DD-<task-slug>.md

For inbox processing JSON receipts, retain the legacy processed path list and
write source_references for stable provenance:

~~~json
{
  "completed_at": "2026-09-08T12:00:00.000Z",
  "processed": ["6-raw/inbox/note.md"],
  "source_references": [
    {
      "source_id": "src_0f1c...",
      "path": "6-raw/archive/2026-09-08/note.md",
      "role": "processed-inbox-item"
    }
  ],
  "summary": "Promoted one note"
}
~~~

New retrieval receipts should list source IDs first and paths second. Paths
are navigation hints and may change after archive moves. Include unresolved or
ambiguous references and the reason for each. Never replace two source IDs with
one merely because their filenames or content hashes match.
