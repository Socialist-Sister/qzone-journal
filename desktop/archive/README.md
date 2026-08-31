# Local archive schema

The archive is a user-owned directory, not an application database. Schema changes are versioned through `manifest.json.schemaVersion` and must remain migratable.

```text
QQ-{uin}/
├─ manifest.json
├─ records/
│  ├─ entries/       # one normalized post, journal, or album per JSON file
│  └─ people/        # reserved for deduplicated commenter/liker profiles
├─ media/
│  ├─ index.json     # source-to-local media mapping and future integrity metadata
│  └─ files/         # downloaded images and videos
├─ state/
│  ├─ checkpoint.json
│  └─ entry-index.json # incremental summary, paging, and search index
└─ diagnostics/
   ├─ session-check.json
   ├─ collection-plan.json
   ├─ revisions/     # previous normalized revisions of updated records
   └─ integrity/     # quarantined corrupt records and repair reports
```

## Invariants

- JSON files are written through a temporary sibling and atomically renamed into place.
- Entry filenames are SHA-256 hashes of `type:sourceId`; titles are optional because QQ status posts are normally titleless.
- Raw cookies, passwords, API keys, and browser storage are never written into an archive.
- `state/checkpoint.json` records the active phase and future per-endpoint cursors so an interrupted job can resume without duplicating completed pages.
- Media bytes and their index are separate from normalized content records so exports can choose whether to embed, link, or omit originals.
- Entry and media indexes are cached during a collection page and flushed atomically in batches. `entry-index.json` is a rebuildable acceleration layer; per-entry JSON remains the source of truth.
- Official comment/like totals live in `metrics`; expanded `comments` and `likes` are explicitly best-effort visible details. Comment authors use the canonical `authorName` field.
- Endpoint responses are normalized at the collector boundary. UI and export code consume the local schema rather than depending on QQ response shapes.
- `archive-index.json` lives in Electron user data and points to the most recently completed archive. It contains only the local path and masked account label, allowing the UI to reopen an archive without restoring a QQ session.

## Incremental and recovery rules

- Every successful collection records a posts high-water mark, recent source IDs, the last full-scan time, and added/updated/skipped counts in `manifest.json`.
- A recent archive stops paging after a complete page contains only known, unchanged records. At least once every 30 days it performs a full scan so older edits can still be discovered.
- The same `type:sourceId` always resolves to the same entry file. An unchanged record is skipped; a changed record atomically replaces the current entry and the previous JSON is retained under `diagnostics/revisions/`.
- Duplicate appearances of the same source record do not create duplicate entry files.
- Records that disappear from a QQ response are retained locally. A missing upstream item may be deleted, hidden, rate-limited, or temporarily unavailable, so this application never treats absence as authorization to delete the user's archive.
- Integrity checks validate normalized entry JSON and local media paths. Repair moves malformed entries into an archive-local quarantine and clears invalid media paths so a later backup can download the originals again.
