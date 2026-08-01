---
name: Nina has two whey-removal stages
description: Nina's recipe has two separate "retirar soro" stages with near-identical names; verify which one before touching either.
---

Queijo Nina's recipe has **two** distinct whey-removal stages, both named almost identically in Portuguese:
- An earlier stage ("Retirar soro do tanque") that removes a **calculated partial volume** (~20% of milk) before the semi-cozimento/hot-water step — this calculation is intentional and correct.
- A later stage ("Retirar todo o soro do tanque") that removes **all** remaining whey with no calculation at all — already implemented correctly, using `parameters.volume_note` instead of `parameters.volume_source`.

**Why:** A user bug report about "soro" removal saying a calculated volume when it shouldn't can easily be misattributed to the wrong one of these two stages, since both mention "soro"/"retirar" and sit only ~2 stages apart. Fixing the wrong stage (e.g. removing the calc from the partial-removal stage) breaks working behavior while leaving the actual complaint (if any) unaddressed.

**How to apply:** Before changing a Nina whey-removal stage, read both stages' current `id`, `name`, and `parameters` from the recipe YAML (and check logs/DB for the batch's actual `currentStageId` and spoken text) to confirm exactly which one the user means, rather than assuming from the stage name alone.
