---
name: Recipe stage-behavior changes via versioning
description: How to safely change a single stage's calculation/instructions in the Nina/Nete recipe YAMLs without breaking batches already in progress.
---

The recipe system supports multiple stage-list versions per recipe (recipe-nina.yml = v1, recipe-nina-v2.yml = v2, etc., keyed by a `version:` field and loaded automatically by filename pattern `recipe-*.yml`). Each batch records the version it was created with and always resolves against that version; new batches automatically get the highest available version.

When a fix needs to change one stage's behavior (remove a calculated dose, reword instructions, drop a `parameters.volume_source`), don't edit the shared/generic calculation code and don't edit the latest version file in a way that could look like a stage-id hardcode — copy the latest version file to a new `-vN.yml`, bump `version:`, and make the change there. In-flight batches on the old version keep the old behavior; new batches pick up the fix automatically.

**Why:** Shared hint-building code (e.g. `getCalculatedInputHint` in batchService.ts) resolves which stage id owns a given derived-volume calc dynamically via `getStageByVolumeSource(...)`, specifically so stage-id shifts across recipe versions don't break the hint. If that lookup returns `undefined` (because a newer version removed the calc from that stage) and the code falls back to a hardcoded default id (e.g. `?? 15`), the hint reappears on whatever stage now happens to have that id — a regression that's easy to introduce by "just following the existing pattern" without checking why the fallback existed. Remove the hardcoded fallback instead: no match should mean no hint.

**How to apply:** Before removing a stage's `parameters.volume_source: X` reference in a new recipe version, also grep for any `?? <hardcoded stage id>` fallback tied to that volume-source lookup and remove it, so "no stage declares this calc anymore" degrades to "no hint" rather than a wrong hint on the wrong stage. If the removed calc key isn't used by any other stage, it's safe to drop the corresponding `derived_volumes` entry entirely in the new version — other entries in the same list keep computing independently.
