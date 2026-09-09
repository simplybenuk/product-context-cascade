```yaml
---
title: <title>
layer: <2|3|4|5|6>
owner: <name>
last_updated: YYYY-MM-DD
confidence: high|medium|low
status: draft|active|archived
tags: [tag1, tag2]
source_id: <immutable source ID when this file represents a source>
source_type: <text_note|local_file|synced_file|attachment|imported_export>
content_hash: <sha256 hash when this file is registered>
original_date: YYYY-MM-DD
captured_at: <ISO-8601 timestamp>
channel: <capture or import channel>
source_reference:
  kind: <file|external>
  value: <portable path or external reference>
attachments: []
visibility: internal
retention:
  policy: workspace-default
  retain_until: null
  legal_hold: false
summary: <one-line summary>
when_to_read:
  - <condition>
skip_if:
  - <condition>
---
```
