---
name: Multi-recipe UI and Alexa
description: How the system supports multiple cheese recipes (Nete/Nina) across UI and Alexa flows
---

## Rule
All recipe-specific rendering must use `stageInfo` from the batch API response, never hardcoded stage IDs or recipe-specific constants.

**Why:** Nina has 23 stages (vs Nete's 19). Stages for pH input, ferment add, loop pH etc. differ between recipes. Hardcoding Nete's stage numbers broke Nina batches.

**How to apply:**
- `GET /api/batches/:id` returns `stageInfo` (from `rm.formatStageDetail`) with `requiredInputs`, `type`, `instructions`, `timer`
- `GET /api/batches/list` returns `totalStages` and `recipeName` per batch
- UI derives behavior from `stageInfo.requiredInputs` (e.g. `isLoopPhStage = stageInfo.type === 'loop' && requiredInputs.includes('ph_value')`)
- Ferment timestamps: look in `measurements._history` for entries with `stageId === currentStageId` and keys in the known set (`ferment_lr_dx_add_time_iso`, `ferment_kl_coalho_add_time_iso`, `ferment_add_time`, `rennet_add_time`)
- Alexa multi-turn flow: after volume capture → `START_BATCH_RECIPE` pending state asks "Nete ou Nina?"; FallbackIntent reprompts; ProcessCommandIntent handles selection
- Stage 13 input type gating (Nete) and Stage 18 (Nina) both detected by `requiredInputs.includes('ph_value') && requiredInputs.includes('pieces_quantity')`
