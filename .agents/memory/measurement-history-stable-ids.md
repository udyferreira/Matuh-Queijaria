---
name: Stable ids for _history/ph_measurements entries
description: Why measurement edits must match by a stable entry id, not positional historyIndex or timestamp.
---

Each entry in `batch.measurements._history` (and the parallel `ph_measurements` array) now carries
an `id` generated at creation time. Edits (`PUT /api/batches/:id/measurements`) must match the
target entry by `entryId` first, falling back to the legacy `historyIndex`/timestamp match only for
entries created before this existed.

**Why:** loop stages can produce several `ph_measurement`/`ph_value` entries with the identical
`key` and `stageId`, differing only by timestamp (down to the millisecond). Matching by array
position (`historyIndex`) or timestamp is fragile — any concurrent append (fast test-mode timers,
Alexa-driven `logPh` calls) or timestamp truncation (e.g. losing seconds when building a new
timestamp from HH:MM inputs) silently updates the wrong entry. This caused the same "pH edit
doesn't stick" bug to resurface three times before the id-based fix.

**How to apply:** any new code path that pushes into `_history` or `ph_measurements` must generate
an `id` via the existing `generateId()` helper (in `server/routes.ts` / `server/batchService.ts`)
and, when the same measurement is mirrored into both arrays, share the *same* id between them so a
future edit can locate both consistently. Deliberately no backfill was done for pre-existing
entries — they keep working via the historyIndex fallback, so this is safe for in-progress
production batches.
