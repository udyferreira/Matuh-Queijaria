---
name: Stage-15 timer and recipe isolation
description: Key patterns for stage-15 pH loop, timer management, per-batch recipe isolation, and Alexa speech enrichment
---

## Stage-15 1h30 non-blocking timer

When `advanceBatch` enters stage 15, a 1h30 non-blocking timer is added to `activeTimers` (TEST_MODE=2min). When `logPh` is called at stage 15, the timer is cancelled and a new 1h30 timer starts (unless pH < TARGET_PH=5.3, in which case the timer is cleared entirely). This is all in `server/batchService.ts`.

**Why:** The timer is non-blocking so the operator can advance early if pH target is reached before 1h30 is up.

## Per-batch recipe isolation

`getRecipeForBatch(batch)` in `server/recipe.ts` is a synchronous helper that returns a `RecipeManager` instance from the batch's `recipeSnapshot` if present, otherwise falls back to the global `recipeManager`. All batch-specific logic in `batchService.ts` must use `getRecipeForBatch(batch)` instead of the global `recipeManager`.

**How to apply:** Any new function in batchService.ts that needs recipe stages should call `const rm = getRecipeForBatch(batch)` at the top.

## Alexa stage-15 speech enrichment

`buildStage15Context(batch)` in `server/routes.ts` builds a deterministic context string including turning cycle count, last pH, and timer remaining. It is called in:
- `LaunchRequest` (resume persisted batch path) — added to include stage-15 context in welcome speech
- `buildBatchSelectionMenu` — single-batch and multi-batch selection
- `SelectBatchIntent` — after batch selection
- `ContinueIntent` / `AMAZON.YesIntent` — early return for stage 15 using direct template narration

**Why:** LLM narration of timer was unreliable; deterministic template ensures timer info is always spoken.

## llm_guidance for stage 15 (recipe.yml)

The llm_guidance for stage 15 explicitly states the pH target is < 5.3 and instructs the LLM to use "cinco vírgula três" (5.3) as examples — NOT 5.2. The `input_prompt` still says "cinco vírgula dois" (user explicitly rolled that back before; do NOT change it).

## DB schema for recipe CRUD

The following were added to the DB but the full CRUD feature (routes + frontend) is NOT yet complete:
- `production_batches.recipe_name` TEXT
- `production_batches.recipe_snapshot` JSONB
- `recipes` table (recipe_id, name, family, stages JSONB, etc.)

The `recipes` table still needs to be seeded (via `seedRecipesIfEmpty()` in `server/recipeService.ts`) and the CRUD routes/frontend pages need to be built.
