---
name: logPh timer reset
description: How to correctly reset the active timer in logPh for loop stages — Nete vs Nina difference
---

# logPh timer reset for loop stages

## The Rule
In `batchService.ts logPh()`, use `getIntervalDurationMinutes(currentStageData)` (imported from `recipe.ts`) to check for and compute interval timers. Do NOT access `currentStageData?.timer?.interval_hours` directly — this evaluated falsy for Nina stage 20 despite the YAML having `interval_hours: 2`.

## Why
- Nete loop stage (e.g. stage 15) uses `max_loop_duration_hours: 1.5` — captured by `currentStageData?.max_loop_duration_hours`.
- Nina loop stage (e.g. stage 20) uses `timer: { interval_hours: 2 }` — NOT `max_loop_duration_hours`. Accessing `currentStageData?.timer?.interval_hours` directly returned falsy (root cause unclear — possibly optional chaining or ?? operator behavior with tsx compilation).
- `getIntervalDurationMinutes()` is the same helper used in `advanceBatch` to create the initial timer. It already handles TEST_MODE (returns 10/60 seconds) and production correctly.

## How to apply
```ts
const maxLoopHours = currentStageData?.max_loop_duration_hours;
const intervalMinutes = getIntervalDurationMinutes(currentStageData);
const hasLoopTimer = !!(maxLoopHours || intervalMinutes > 0);
if (hasLoopTimer) {
  const phTimerMinutes = TEST_MODE ? (10/60)
    : maxLoopHours ? Math.round(maxLoopHours * 60)
    : intervalMinutes;
  // ... push to activeTimers
}
```

This covers both recipe types correctly.
