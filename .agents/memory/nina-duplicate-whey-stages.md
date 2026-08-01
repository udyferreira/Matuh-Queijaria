---
name: Speech dose matching must be structural, not text-based
description: getRelevantDosesForStage in server/speechRenderer.ts must match doses to stages via stage.parameters.volume_source, never via stage name/instruction text keywords or unrelated parameter fields (e.g. heat_source).
---

Nina's recipe has multiple stages with near-identical wording (two "retirar soro" stages, a "tanque pequeno"/leite stage that appears in both a calc stage and a later "juntar" stage, an "água quente" stage used both to prepare water with a volume and later to reuse that water in an unrelated heating loop). Any dose-matching logic in `getRelevantDosesForStage` that keys off substrings in the stage name/instructions (or off an unrelated field like `heat_source` that merely says "this stage uses that resource") will falsely re-announce a calculated volume on a stage that doesn't own it.

**Why:** Already found and fixed this exact bug independently for WHEY_TO_REMOVE (stage 18 inherited stage 16's volume) and HOT_WATER (stage 17's heating loop inherited stage 10's volume via a stray `heat_source` match). A third instance (SMALL_TANK_MILK leaking from stage 3 into stage 5) was found but left as a follow-up task since it was out of scope.

**How to apply:** When touching `getRelevantDosesForStage`, require an exact `stage.parameters?.volume_source === '<DOSE_KEY>'` check for every dose type instead of any text/keyword condition. Before trusting any existing text-based branch left in that function, check whether a similar leak exists at another same-named stage and prefer converting it to the structural check pattern.
