---
name: Loop interval timer init
description: Loop stages using interval_hours were missing activeTimers entry at stage entry; only activeReminders was created.
---

## The rule
When `advanceBatch` enters a `loop` stage that uses `timer.interval_hours` (not `max_loop_duration_hours`), an `activeTimers` entry must be explicitly created alongside the `activeReminders` entry. Otherwise the UI countdown is empty until the first pH log.

**Why:** The `intervalMinutes > 0` block in `advanceBatch` only pushed to `activeReminders`. The `max_loop_duration_hours` block (which does push to `activeTimers`) only fires for stages that have that YAML field. Nina stage 21 uses `interval_hours: 2` with no `max_loop_duration_hours`, so `activeTimers` was never populated on entry.

**How to apply:** In the `if (intervalMinutes > 0)` block inside `advanceBatch`, after pushing to `activeReminders`, also push to `activeTimers` when `nextStage.type === 'loop'`. The `logPh` function already resets this timer correctly on each cycle — the fix is only needed at entry time.

**Affected stage:** Nina stage 21 ("Virar queijos e medir pH"). Any future loop stage using `interval_hours` would have the same gap.
