import { storage } from "./storage";
import { recipeManager, recipeRegistry, RecipeManager, getRecipeForBatch, getTimerDurationMinutes, getIntervalDurationMinutes, getWaitSpecForStage, getWaitSpecForStageData, TEST_MODE } from "./recipe";
import { CHEESE_TYPES } from "@shared/schema";
import { randomBytes } from "crypto";
import { ApiContext, ScheduledAlert, scheduleReminderForWait, cancelReminder, cancelAllBatchReminders, scheduleMultipleReminders } from "./alexaReminders";

const generateId = () => randomBytes(8).toString('hex');

/**
 * Normalize pH value: 54 -> 5.4, 62 -> 6.2, 66 -> 6.6, etc.
 * Handles cases like "54" spoken as "cinquenta e quatro" for pH 5.4
 * Also handles PH66 → 6.6 ASR errors, "5 5" → 5.5, "6-5" → 6.5, "6,5" → 6.5
 * 
 * Rules:
 * - If raw is number and raw > 14 and raw < 100 => raw/10 (55=>5.5, 66=>6.6)
 * - If raw is string: remove "pH", spaces, replace vírgula with dot
 * - Handle patterns: "5 5" => 5.5, "6-5" => 6.5, "52" => 5.2
 * - Validate range: 3.5 to 8.0 (typical for cheese making)
 */
export function normalizePHValue(rawValue: string | number): number | null {
  if (rawValue === undefined || rawValue === null || rawValue === '?' || rawValue === '') {
    return null;
  }
  
  let valueStr = String(rawValue)
    .toUpperCase()
    .replace(/PH/g, '')           // Remove "PH" prefix
    .replace(/\s+/g, ' ')         // Normalize whitespace
    .trim();
  
  // Handle comma as decimal separator (Portuguese): "5,5" -> "5.5"
  valueStr = valueStr.replace(',', '.');
  
  // Handle patterns like "5 5" or "6 5" (space between digits) -> 5.5, 6.5
  const spacedPattern = /^(\d)\s+(\d)$/;
  const spacedMatch = valueStr.match(spacedPattern);
  if (spacedMatch) {
    valueStr = `${spacedMatch[1]}.${spacedMatch[2]}`;
    console.log(`[normalizePH] "${rawValue}" matched spaced pattern -> ${valueStr}`);
  }
  
  // Handle patterns like "6-5" (hyphen between digits) -> 6.5
  const hyphenPattern = /^(\d)-(\d)$/;
  const hyphenMatch = valueStr.match(hyphenPattern);
  if (hyphenMatch) {
    valueStr = `${hyphenMatch[1]}.${hyphenMatch[2]}`;
    console.log(`[normalizePH] "${rawValue}" matched hyphen pattern -> ${valueStr}`);
  }
  
  let num = parseFloat(valueStr);
  if (isNaN(num)) {
    console.log(`[normalizePH] "${rawValue}" -> NaN after parsing "${valueStr}"`);
    return null;
  }
  
  // If value >= 100 and < 1000, divide by 100 (e.g., 660 -> 6.60)
  if (num >= 100 && num < 1000) {
    num = num / 100;
    console.log(`[normalizePH] ${rawValue} -> ${num} (divided by 100)`);
  }
  // If value > 14 and < 100 (clearly not a valid pH), divide by 10
  // This handles: 66 -> 6.6, 55 -> 5.5, 52 -> 5.2
  else if (num > 14 && num < 100) {
    num = num / 10;
    console.log(`[normalizePH] ${rawValue} -> ${num} (divided by 10)`);
  }
  
  // Validate pH range (3.5 to 8.0 is acceptable for cheese making)
  if (num < 3.5 || num > 8.0) {
    console.log(`[normalizePH] ${rawValue} -> ${num} is outside valid range 3.5-8.0`);
    return null;
  }
  
  const result = Math.round(num * 100) / 100; // Round to 2 decimal places
  console.log(`[normalizePH] "${rawValue}" -> ${result}`);
  return result;
}

export function normalizeTemperatureValue(rawValue: string | number): number | null {
  if (rawValue === undefined || rawValue === null || rawValue === '?' || rawValue === '') {
    return null;
  }

  let valueStr = String(rawValue)
    .replace(/\s+/g, ' ')
    .replace(/graus?/gi, '')
    .trim();

  valueStr = valueStr.replace(',', '.');

  const spacedPattern = /^(\d+)\s+(\d)$/;
  const spacedMatch = valueStr.match(spacedPattern);
  if (spacedMatch) {
    valueStr = `${spacedMatch[1]}.${spacedMatch[2]}`;
    console.log(`[normalizeTemp] "${rawValue}" matched spaced pattern -> ${valueStr}`);
  }

  const hyphenPattern = /^(\d+)-(\d)$/;
  const hyphenMatch = valueStr.match(hyphenPattern);
  if (hyphenMatch) {
    valueStr = `${hyphenMatch[1]}.${hyphenMatch[2]}`;
    console.log(`[normalizeTemp] "${rawValue}" matched hyphen pattern -> ${valueStr}`);
  }

  let num = parseFloat(valueStr);
  if (isNaN(num)) {
    console.log(`[normalizeTemp] "${rawValue}" -> NaN after parsing "${valueStr}"`);
    return null;
  }

  if (num > 50 && num < 100) {
    num = num / 10;
    console.log(`[normalizeTemp] ${rawValue} -> ${num} (divided by 10, ASR likely dropped decimal)`);
  }

  if (num < 0 || num > 50) {
    console.log(`[normalizeTemp] ${rawValue} -> ${num} is outside valid range 0-50°C`);
    return null;
  }

  const result = Math.round(num * 10) / 10;
  console.log(`[normalizeTemp] "${rawValue}" -> ${result}`);
  return result;
}

export interface StartBatchParams {
  milkVolumeL: number;
  milkTemperatureC: number;
  milkPh: number;
  recipeId?: string;
}

export interface StartBatchResult {
  success: boolean;
  batch?: any;
  error?: string;
  code?: string;
  missingFields?: string[];
}

export interface AdvanceBatchResult {
  success: boolean;
  batch?: any;
  completed?: boolean;
  nextStage?: { id: number; name: string };
  error?: string;
  code?: string;
  reminderScheduled?: boolean;
  needsReminderPermission?: boolean;
  waitDurationText?: string;
}

export async function startBatch(params: StartBatchParams): Promise<StartBatchResult> {
  const { milkVolumeL, milkTemperatureC: rawMilkTemp, milkPh: rawMilkPh, recipeId: rawRecipeId = "QUEIJO_NETE" } = params;
  
  const recipeId = rawRecipeId;
  
  const milkPh = normalizePHValue(rawMilkPh);
  const milkTemperatureC = normalizeTemperatureValue(rawMilkTemp);
  
  const missingFields: string[] = [];
  if (milkVolumeL === undefined || milkVolumeL === null) missingFields.push("volume");
  if (milkTemperatureC === undefined || milkTemperatureC === null) missingFields.push("temperatura");
  if (milkPh === undefined || milkPh === null) missingFields.push("pH");
  
  if (missingFields.length > 0) {
    return {
      success: false,
      error: `Faltam dados: ${missingFields.join(", ")}`,
      code: "MISSING_REQUIRED_FIELDS",
      missingFields
    };
  }
  
  // Validate recipeId against known cheese types
  const cheeseType = CHEESE_TYPES[recipeId as keyof typeof CHEESE_TYPES];
  if (!cheeseType) {
    return {
      success: false,
      error: `Receita não encontrada: ${recipeId}`,
      code: "INVALID_CHEESE_TYPE"
    };
  }

  // New batches always start on the latest stage-list version for their recipe.
  // Existing in-progress batches are unaffected: they keep resolving against
  // whatever version they were created with (see getRecipeForBatch).
  const recipeVersion = recipeRegistry.getLatestVersion(recipeId);
  const batchRm = recipeRegistry.getForRecipeId(recipeId, recipeVersion) || recipeManager;
  const inputs = batchRm.calculateInputs(milkVolumeL);
  
  const initialMeasurements: Record<string, any> = {
    milk_volume_l: milkVolumeL,
    milk_temperature_c: milkTemperatureC,
    milk_ph: milkPh,
    _history: [
      { key: 'milk_volume_l', value: milkVolumeL, timestamp: new Date().toISOString(), stageId: 1 },
      { key: 'milk_temperature_c', value: milkTemperatureC, timestamp: new Date().toISOString(), stageId: 1 },
      { key: 'milk_ph', value: milkPh, timestamp: new Date().toISOString(), stageId: 1 }
    ]
  };

  const batch = await storage.createBatch({
    recipeId: recipeId,
    recipeVersion,
    currentStageId: 3,
    milkVolumeL: String(milkVolumeL),
    calculatedInputs: inputs,
    measurements: initialMeasurements,
    status: "active",
    history: [
      { stageId: 1, action: "complete", timestamp: new Date().toISOString(), auto: true },
      { stageId: 2, action: "complete", timestamp: new Date().toISOString(), auto: true },
      { stageId: 3, action: "start", timestamp: new Date().toISOString() }
    ]
  } as any);

  await storage.logBatchAction({
    batchId: batch.id,
    stageId: 3,
    action: "start",
    details: { milkVolume: milkVolumeL, milkTemperatureC, milkPh, calculatedInputs: inputs }
  });

  return { success: true, batch };
}

export async function advanceBatch(batchId: number, apiCtx?: ApiContext | null): Promise<AdvanceBatchResult> {
  const batch = await storage.getBatch(batchId);
  if (!batch) {
    return { success: false, error: "Lote não encontrado", code: "BATCH_NOT_FOUND" };
  }

  const rm = getRecipeForBatch(batch);
  const currentStage = rm.getStage(batch.currentStageId);
  if (!currentStage) {
    return { success: false, error: "Etapa inválida", code: "INVALID_STAGE" };
  }

  if (rm.isLoopStage(batch.currentStageId)) {
    const measurements = (batch.measurements as Record<string, any>) || {};
    const canExitByPh = rm.checkLoopExitCondition(batch.currentStageId, measurements);
    
    if (!canExitByPh) {
      const phMessage = measurements.ph_value 
        ? `pH atual: ${measurements.ph_value}` 
        : 'pH ainda não medido';
      return {
        success: false,
        error: `pH deve ser menor que 5.3 para sair desta etapa (${phMessage}). Continue monitorando o pH.`,
        code: "LOOP_CONDITION_NOT_MET"
      };
    }

    if (rm.isLoopStage(batch.currentStageId)) {
      const loopStageId = batch.currentStageId;
      const freshBatch = await storage.getBatch(batchId);
      if (freshBatch) {
        const freshMeasurements = (freshBatch.measurements as Record<string, any>) || {};
        const turningCount = (freshBatch as any).turningCyclesCount || 0;
        const timestamp = new Date().toISOString();
        const historyEntries = [
          { id: generateId(), key: 'turning_cycles_count', value: turningCount, stageId: loopStageId, timestamp },
          { id: generateId(), key: 'loop_exit_reason', value: 'ph_reached', stageId: loopStageId, timestamp }
        ];
        const history = freshMeasurements._history || [];
        history.push(...historyEntries);
        freshMeasurements._history = history;
        await storage.updateBatch(batchId, { measurements: freshMeasurements });
      }
    }
  }

  const validation = rm.validateAdvance(batch, currentStage);
  if (!validation.allowed) {
    return {
      success: false,
      error: validation.reason || "Não é possível avançar agora.",
      code: "VALIDATION_FAILED"
    };
  }

  const nextStage = rm.getNextStage(batch.currentStageId);
  if (!nextStage) {
    const alerts = (batch.scheduledAlerts as Record<string, ScheduledAlert>) || {};
    if (apiCtx && Object.keys(alerts).length > 0) {
      await cancelAllBatchReminders(apiCtx, alerts);
    }
    const completed = await storage.updateBatch(batchId, { 
      status: "completed",
      completedAt: new Date(),
      scheduledAlerts: {}
    });
    return { success: true, batch: completed, completed: true };
  }

  let activeTimers = (batch.activeTimers as any[]) || [];
  activeTimers = activeTimers.filter(t => t.stageId !== currentStage.id);

  let activeReminders = (batch.activeReminders as any[]) || [];
  activeReminders = activeReminders.filter((r: any) => r.stageId !== currentStage.id);

  let scheduledAlerts = { ...((batch.scheduledAlerts as Record<string, ScheduledAlert>) || {}) };
  const prevKey = `stage_${currentStage.id}`;
  if (scheduledAlerts[prevKey] && apiCtx) {
    const alertDueAt = scheduledAlerts[prevKey].dueAtISO
      ? new Date(scheduledAlerts[prevKey].dueAtISO).getTime()
      : 0;
    const alertAlreadyFired = alertDueAt > 0 && alertDueAt < Date.now();
    const isRecurringAlert = scheduledAlerts[prevKey].kind === 'recurring_interval';
    // Recurring reminders must always be explicitly cancelled — they remain active after the first firing
    if (!alertAlreadyFired || isRecurringAlert) {
      await cancelReminder(apiCtx, scheduledAlerts[prevKey].reminderId);
    } else {
      console.log(`[advanceBatch] Stage ${currentStage.id} reminder already fired (dueAt=${scheduledAlerts[prevKey].dueAtISO}). Skipping cancelReminder API call.`);
    }
    delete scheduledAlerts[prevKey];
  }

  // Cancel any heat_curd multi-alerts for this stage (stage_N_alert_1 ... stage_N_alert_10)
  const multiAlertPrefix = `stage_${currentStage.id}_alert_`;
  const multiAlertKeys = Object.keys(scheduledAlerts).filter(k => k.startsWith(multiAlertPrefix));
  if (multiAlertKeys.length > 0) {
    console.log(`[advanceBatch] Cancelling ${multiAlertKeys.length} heat_curd alert(s) for stage ${currentStage.id}`);
    for (const key of multiAlertKeys) {
      const alert = scheduledAlerts[key];
      const dueAt = alert.dueAtISO ? new Date(alert.dueAtISO).getTime() : 0;
      const alreadyFired = dueAt > 0 && dueAt < Date.now();
      if (!alreadyFired && apiCtx) {
        await cancelReminder(apiCtx, alert.reminderId);
      }
      delete scheduledAlerts[key];
    }
  }

  const updates: any = {
    currentStageId: nextStage.id,
    activeTimers,
    activeReminders,
    scheduledAlerts
  };

  if (nextStage.type === 'loop' && nextStage.max_loop_duration_hours) {
    const maxHours = nextStage.max_loop_duration_hours;
    const phTimerMinutes = TEST_MODE ? (10/60) : Math.round(maxHours * 60);
    const timerDesc = TEST_MODE ? "10 segundos (TESTE)" : `${maxHours} hora(s)`;
    activeTimers.push({
      id: generateId(),
      stageId: nextStage.id,
      durationMinutes: phTimerMinutes,
      startTime: new Date().toISOString(),
      endTime: new Date(Date.now() + phTimerMinutes * 60000).toISOString(),
      description: timerDesc,
      blocking: false
    });
    updates.activeTimers = activeTimers;
  }

  if (nextStage.timer) {
    const durationMinutes = getTimerDurationMinutes(nextStage);
    const intervalMinutes = getIntervalDurationMinutes(nextStage);
    
    if (intervalMinutes > 0) {
      const stageTimerDef = nextStage.timer;
      const intervalDesc = TEST_MODE ? "10 segundos (TESTE)"
        : stageTimerDef?.interval_min ? `${stageTimerDef.interval_min} minutos`
        : `${stageTimerDef?.interval_hours} hora(s)`;
      activeReminders.push({
        id: generateId(),
        stageId: nextStage.id,
        type: "interval",
        intervalHours: intervalMinutes / 60,
        nextTrigger: new Date(Date.now() + intervalMinutes * 60000).toISOString(),
        acknowledged: false,
        description: `Alerta a cada ${intervalDesc}`
      });
      updates.activeReminders = activeReminders;

      // Loop stages using interval_hours (e.g. Nina stage 21) also need a visible
      // countdown in activeTimers so the UI and logPh can display/reset the cycle timer.
      // Non-loop interval stages (e.g. Nina stage 15 semi-cozimento) already create
      // their activeTimers entry via the max_loop_duration_hours block above.
      if (nextStage.type === 'loop') {
        const phTimerMinutes = TEST_MODE ? (10 / 60) : intervalMinutes;
        activeTimers.push({
          id: generateId(),
          stageId: nextStage.id,
          durationMinutes: phTimerMinutes,
          startTime: new Date().toISOString(),
          endTime: new Date(Date.now() + phTimerMinutes * 60000).toISOString(),
          description: intervalDesc,
          blocking: false
        });
        updates.activeTimers = activeTimers;
        console.log(`[advanceBatch] Loop interval timer started for stage=${nextStage.id} duration=${phTimerMinutes} min`);
      }
    }
    
    if (durationMinutes > 0) {
      const blocking = nextStage.timer.blocking === true;
      const timer = nextStage.timer as any;
      const timerDesc = TEST_MODE 
        ? "10 segundos (TESTE)"
        : (timer.duration || `${durationMinutes} min`);
      activeTimers.push({
        id: generateId(),
        stageId: nextStage.id,
        durationMinutes,
        startTime: new Date().toISOString(),
        endTime: new Date(Date.now() + durationMinutes * 60000).toISOString(),
        description: timerDesc,
        blocking
      });
      updates.activeTimers = activeTimers;
    }
  }

  if (nextStage.reminder) {
    const reminder = nextStage.reminder as any;
    const reminderHours = TEST_MODE 
      ? (10/3600)
      : (reminder.interval_hours || 1);
    activeReminders.push({
      id: generateId(),
      stageId: nextStage.id,
      type: reminder.type || "interval",
      intervalHours: reminderHours,
      nextTrigger: new Date(Date.now() + reminderHours * 3600000).toISOString(),
      acknowledged: false,
      description: reminder.message || `Lembrete etapa ${nextStage.id}`
    });
    updates.activeReminders = activeReminders;
  }

  const updatedHistory = [...((batch.history as any[]) || [])];
  updatedHistory.push({ stageId: currentStage.id, action: "complete", timestamp: new Date().toISOString() });
  updatedHistory.push({ stageId: nextStage.id, action: "start", timestamp: new Date().toISOString() });
  updates.history = updatedHistory;

  const measurements = (batch.measurements as Record<string, any>) || {};
  const nowIso = new Date().toISOString();
  let touchedMeasurements = false;
  const batchRecipeId = ((batch as any).recipeId || 'QUEIJO_NETE') as string;
  const isNete = batchRecipeId === 'QUEIJO_NETE';

  // Generic: auto_record_timestamp defined in YAML — records on ENTRY to the next stage.
  // Both recipes (and all their versions) declare this field on the relevant stages
  // (Nina: ferment/rennet add, brine entry, shelf start; Nete: ferment LR/DX + KL/coalho
  // add, brine entry, shelf start), so this single generic block covers every case
  // without hardcoding stage numbers per recipe/version.
  if (nextStage.auto_record_timestamp && !measurements[nextStage.auto_record_timestamp]) {
    measurements[nextStage.auto_record_timestamp] = nowIso;
    const mHistory = measurements._history || [];
    mHistory.push({ id: generateId(), key: nextStage.auto_record_timestamp, value: nowIso, stageId: nextStage.id, timestamp: nowIso });
    measurements._history = mHistory;
    touchedMeasurements = true;
  }

  if (touchedMeasurements) {
    updates.measurements = measurements;
  }

  const updatedBatch = await storage.updateBatch(batchId, updates);
  
  await storage.logBatchAction({
    batchId,
    stageId: nextStage.id,
    action: "advance",
    details: { from: currentStage.id, to: nextStage.id }
  });

  let reminderScheduled = false;
  let needsPermission = false;
  const waitSpec = getWaitSpecForStageData(nextStage);

  let waitDurationText: string | undefined;
  if (waitSpec) {
    const totalMin = Math.round(waitSpec.seconds / 60);
    if (totalMin >= 60) {
      const h = Math.floor(totalMin / 60);
      const m = totalMin % 60;
      waitDurationText = m > 0 ? `${h} hora${h > 1 ? 's' : ''} e ${m} minutos` : `${h} hora${h > 1 ? 's' : ''}`;
    } else {
      waitDurationText = `${totalMin} minuto${totalMin !== 1 ? 's' : ''}`;
    }
  }

  console.log(`[REMINDER] advanceBatch: batch=${batchId} nextStage=${nextStage.id} waitSpec=${waitSpec ? JSON.stringify(waitSpec) : 'null'} waitDurationText=${waitDurationText || 'none'} apiCtx=${apiCtx ? 'present' : 'NULL'}`);

  if (waitSpec) {
    if (apiCtx) {
      const newKey = `stage_${nextStage.id}`;
      if (scheduledAlerts[newKey]) {
        await cancelReminder(apiCtx, scheduledAlerts[newKey].reminderId);
        delete scheduledAlerts[newKey];
      }
      const batchRecipeManager = getRecipeForBatch(batch);
      // Interval stages (e.g. Nina stage 15) use Alexa's native recurring reminder
      const stageIntervalMinutes = getIntervalDurationMinutes(nextStage);
      const recurrenceRuleMinutes = stageIntervalMinutes > 0 ? stageIntervalMinutes : undefined;
      const reminderResult = await scheduleReminderForWait(
        apiCtx,
        { id: batchId, recipeId: batch.recipeId },
        nextStage.id,
        waitSpec.seconds,
        undefined,
        nextStage.name,
        batchRecipeManager.getRecipeName(),
        recurrenceRuleMinutes
      );
      if (reminderResult.reminderId) {
        const alertKind = recurrenceRuleMinutes ? 'recurring_interval' : waitSpec.kind;
        scheduledAlerts[newKey] = {
          reminderId: reminderResult.reminderId,
          stageId: nextStage.id,
          dueAtISO: new Date(Date.now() + waitSpec.seconds * 1000).toISOString(),
          kind: alertKind
        };
        await storage.updateBatch(batchId, { scheduledAlerts });
        reminderScheduled = true;
      } else if (reminderResult.permissionDenied) {
        needsPermission = true;
        console.log(`[REMINDER] Permission denied by API for batch=${batchId} stage=${nextStage.id}. User must grant reminder permission.`);
      }
    } else {
      needsPermission = true;
      console.log(`[REMINDER] No apiAccessToken available for batch=${batchId} stage=${nextStage.id}. Permission needed.`);
    }
  }

  // Heat-curd stages (e.g. Nina stage 16): schedule 10 fixed-interval reminders
  // instead of a single recurring one. These are non-blocking (waitSpec is null),
  // so this block runs independently of the waitSpec section above.
  if (nextStage.type === 'heat_curd' && apiCtx) {
    const batchRecipeManager = getRecipeForBatch(batch);
    const intervalMin = TEST_MODE ? 0.2 : 3;
    const count = TEST_MODE ? 3 : 10;
    console.log(`[REMINDER] heat_curd stage ${nextStage.id}: scheduling ${count} reminders every ${intervalMin} min for batch=${batchId}`);
    const multiResults = await scheduleMultipleReminders(
      apiCtx,
      { id: batchId, recipeId: batch.recipeId },
      nextStage.id,
      count,
      intervalMin,
      undefined,
      nextStage.name,
      batchRecipeManager.getRecipeName()
    );
    for (const { key, alert } of multiResults) {
      scheduledAlerts[key] = alert;
    }
    if (multiResults.length > 0) {
      await storage.updateBatch(batchId, { scheduledAlerts });
      reminderScheduled = true;
      console.log(`[REMINDER] heat_curd: ${multiResults.length} reminder(s) scheduled for batch=${batchId} stage=${nextStage.id}`);
    }
  }

  console.log(`[REMINDER] advanceBatch RESULT: batch=${batchId} nextStage=${nextStage.id} reminderScheduled=${reminderScheduled} needsPermission=${needsPermission} waitDurationText=${waitDurationText || 'none'}`);

  return { 
    success: true, 
    batch: updatedBatch, 
    nextStage: { id: nextStage.id, name: nextStage.name },
    reminderScheduled,
    needsReminderPermission: needsPermission,
    waitDurationText
  };
}

export async function getActiveBatch() {
  const batches = await storage.getActiveBatches();
  return batches[0] || null;
}

export async function getBatch(batchId: number) {
  return storage.getBatch(batchId);
}

export interface BatchSummary {
  batchId: number;
  recipeId: string;
  recipeName: string;
  startedAt: string;
  currentStageId: number;
  currentStageName: string;
  status: string;
}

export async function listInProgressBatches(): Promise<BatchSummary[]> {
  const allBatches = await storage.getActiveBatches();
  
  const summaries: BatchSummary[] = allBatches.map(batch => {
    const rm = getRecipeForBatch(batch);
    const stage = rm.getStage(batch.currentStageId);
    const startedAtISO = batch.startedAt 
      ? new Date(batch.startedAt).toISOString() 
      : new Date().toISOString();
    
    return {
      batchId: batch.id,
      recipeId: batch.recipeId,
      recipeName: rm.getRecipeName(),
      startedAt: startedAtISO,
      currentStageId: batch.currentStageId,
      currentStageName: stage?.name || `Etapa ${batch.currentStageId}`,
      status: batch.status,
    };
  });
  
  summaries.sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime());
  
  console.log(`[listInProgressBatches] Found ${summaries.length} batch(es) with status=active`);
  
  return summaries;
}

export async function getBatchStatus(batchId: number) {
  const batch = await storage.getBatch(batchId);
  if (!batch) return null;
  
  const stage = getRecipeForBatch(batch).getStage(batch.currentStageId);
  const activeTimers = (batch.activeTimers as any[]) || [];
  const now = new Date();
  
  const timersWithStatus = activeTimers.map(t => ({
    ...t,
    isComplete: new Date(t.endTime) <= now,
    remainingSeconds: Math.max(0, Math.ceil((new Date(t.endTime).getTime() - now.getTime()) / 1000))
  }));

  const activeReminders = (batch.activeReminders as any[]) || [];

  return {
    batchId: batch.id,
    currentStageId: batch.currentStageId,
    stageName: stage?.name,
    status: batch.status,
    activeTimers: timersWithStatus,
    activeReminders,
    calculatedInputs: batch.calculatedInputs,
    milkVolumeL: batch.milkVolumeL
  };
}

const TARGET_PH = 5.3;

export interface LogPhResult {
  success: boolean;
  error?: string;
  phValue?: number;
  piecesQuantity?: number;
  stageId?: number;
  turningCyclesCount?: number;
  shouldExitLoop?: boolean;
  phReachedTarget?: boolean;
  isDuplicate?: boolean;
}

/**
 * Log pH measurement for any stage
 * - Stage 13: Stores as initial_ph, optionally with pieces_quantity
 * - Stage 15: Stores in ph_measurements array, increments turning cycles, checks loop exit condition
 * - Other stages: Stores as ph_value
 */
export async function logPh(batchId: number, phValue: number, piecesQuantity?: number): Promise<LogPhResult> {
  const batch = await storage.getBatch(batchId);
  if (!batch) return { success: false, error: "Lote não encontrado" };
  
  const measurements = (batch.measurements as any) || {};
  const inputHistory = measurements._history || [];
  const timestamp = new Date().toISOString();
  const stageId = batch.currentStageId;
  
  const rm = getRecipeForBatch(batch);
  const currentStageData = rm.getStage(stageId);
  const isLoopStage = rm.isLoopStage(stageId);
  const isInitialPhStage = currentStageData?.stored_values?.includes('initial_ph') ?? false;

  const DEDUP_WINDOW_MS = 30_000;
  if (isLoopStage) {
    const phMeasurements = measurements.ph_measurements || [];
    if (phMeasurements.length > 0) {
      const last = phMeasurements[phMeasurements.length - 1];
      if (last.value === phValue && last.stageId === stageId) {
        const elapsed = new Date(timestamp).getTime() - new Date(last.timestamp).getTime();
        if (elapsed < DEDUP_WINDOW_MS) {
          console.log(`[logPh] Dedup: pH ${phValue} already recorded ${elapsed}ms ago at stage ${stageId}. Skipping.`);
          const currentCount = (batch as any).turningCyclesCount || 0;
          const phReachedTarget = phValue < TARGET_PH;
          return { 
            success: true, 
            phValue, 
            piecesQuantity, 
            stageId,
            turningCyclesCount: currentCount,
            shouldExitLoop: phReachedTarget,
            phReachedTarget,
            isDuplicate: true
          };
        }
      }
    }
  }
  
  // Initial pH stage (stored_values contains 'initial_ph'): store as initial_ph + pieces
  if (isInitialPhStage) {
    measurements.initial_ph = phValue;
    inputHistory.push({ id: generateId(), key: 'initial_ph', value: phValue, timestamp, stageId });
    
    if (piecesQuantity !== undefined) {
      measurements.pieces_quantity = piecesQuantity;
      inputHistory.push({ id: generateId(), key: 'pieces_quantity', value: piecesQuantity, timestamp, stageId });
    }
  } else {
    // Loop stages and others: store as ph_value in history array
    measurements.ph_value = phValue;
    const phEntryId = generateId();
    const phHistory = measurements.ph_measurements || [];
    phHistory.push({ id: phEntryId, value: phValue, timestamp, stageId });
    measurements.ph_measurements = phHistory;
    inputHistory.push({ id: phEntryId, key: 'ph_measurement', value: phValue, timestamp, stageId });
  }
  
  measurements._history = inputHistory;
  const updates: any = { measurements };
  
  let turningCyclesCount: number | undefined;
  let shouldExitLoop = false;
  let phReachedTarget = false;
  
  // Loop stage: increment turning cycles, check loop exit, manage timer
  if (isLoopStage) {
    const currentCount = (batch as any).turningCyclesCount || 0;
    turningCyclesCount = currentCount + 1;
    updates.turningCyclesCount = turningCyclesCount;
    
    if (phValue < TARGET_PH) {
      shouldExitLoop = true;
      phReachedTarget = true;
    }
    
    // Manage timer for loop stages: supports both max_loop_duration_hours (Nete) and interval_hours (Nina)
    const maxLoopHours = currentStageData?.max_loop_duration_hours;
    const intervalMinutes = getIntervalDurationMinutes(currentStageData);
    const hasLoopTimer = !!(maxLoopHours || intervalMinutes > 0);
    if (hasLoopTimer) {
      let activeTimers = (batch.activeTimers as any[]) || [];
      activeTimers = activeTimers.filter(t => t.stageId !== stageId);
      
      if (!phReachedTarget) {
        const phTimerMinutes = TEST_MODE ? (10/60)
          : maxLoopHours ? Math.round(maxLoopHours * 60)
          : intervalMinutes;
        const timerDesc = TEST_MODE ? "10 segundos (TESTE)"
          : maxLoopHours ? `${maxLoopHours} hora(s)`
          : `${Math.round(intervalMinutes / 60)} hora(s)`;
        activeTimers.push({
          id: generateId(),
          stageId,
          durationMinutes: phTimerMinutes,
          startTime: new Date().toISOString(),
          endTime: new Date(Date.now() + phTimerMinutes * 60000).toISOString(),
          description: timerDesc,
          blocking: false
        });
        console.log(`[logPh] Stage ${stageId}: pH ${phValue} not at target. Timer reset to ${phTimerMinutes} min.`);
      } else {
        console.log(`[logPh] Stage ${stageId}: pH ${phValue} reached target. Timer cleared.`);
        const currentAlerts = { ...((batch as any).scheduledAlerts || {}) };
        const alertKey = `stage_${stageId}`;
        if (currentAlerts[alertKey]) {
          delete currentAlerts[alertKey];
          updates.scheduledAlerts = currentAlerts;
          console.log(`[logPh] Stage ${stageId}: scheduledAlerts.${alertKey} cleared from DB on pH target reached.`);
        }
      }
      updates.activeTimers = activeTimers;
    }
  }
  
  await storage.updateBatch(batchId, updates);
  
  await storage.logBatchAction({
    batchId,
    stageId,
    action: "log_ph",
    details: { 
      ph_value: phValue,
      ...(piecesQuantity !== undefined && { pieces_quantity: piecesQuantity }),
      ...(turningCyclesCount !== undefined && { turning_cycles: turningCyclesCount })
    }
  });
  
  return { 
    success: true, 
    phValue, 
    piecesQuantity, 
    stageId,
    turningCyclesCount,
    shouldExitLoop,
    phReachedTarget
  };
}

export async function logTime(batchId: number, timeValue: string, timeType?: string) {
  const batch = await storage.getBatch(batchId);
  if (!batch) return { success: false, error: "Lote não encontrado" };

  const rm = getRecipeForBatch(batch);

  const normalizeTimeType = (s?: string): string | null => {
    if (!s || s === '?' || !s.trim()) return null;
    return s.toLowerCase().trim()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z]/g, '');
  };

  // Spoken words map to the recipe's own `expected_time_type` field (e.g.
  // "floculação", "corte", "prensa"). The actual stage id is looked up
  // dynamically via getStageByExpectedTimeType so this works unchanged for
  // any recipe/version, regardless of how stages get renumbered.
  const wordToCanonical: Record<string, string> = {
    flocculation: 'floculação', floculacao: 'floculação', flocoacao: 'floculação',
    flucoacao: 'floculação', fortunacao: 'floculação', flocuacao: 'floculação',
    cut: 'corte', cut_point: 'corte', corte: 'corte', pontodecorte: 'corte', ponto: 'corte',
    press: 'prensa', press_start: 'prensa', prensa: 'prensa', prensagem: 'prensa',
  };

  const normalized = normalizeTimeType(timeType);
  let canonical: string | null = normalized ? (wordToCanonical[normalized] ?? null) : null;

  if (!canonical && normalized) {
    if (normalized.includes('floc') || normalized.includes('fluc') || normalized.includes('fort')) {
      canonical = 'floculação';
    } else if (normalized.includes('cort')) {
      canonical = 'corte';
    } else if (normalized.includes('prens')) {
      canonical = 'prensa';
    }
  }

  let stage = canonical ? rm.getStageByExpectedTimeType(canonical) : undefined;

  if (!stage) {
    // Fall back to whatever time type the operator's *current* stage itself
    // expects, instead of a hardcoded per-stage-number table.
    const currentStage = rm.getStage(batch.currentStageId);
    if (currentStage?.expected_time_type && currentStage.operator_input_required?.length) {
      stage = currentStage;
      console.log(`[logTime] Inferred timeType from stage ${batch.currentStageId} => ${currentStage.expected_time_type} (raw timeType: "${timeType}")`);
    }
  }

  if (!stage || !stage.operator_input_required?.length) {
    return { 
      success: false, 
      error: "Não reconheci o tipo de horário. Diga, por exemplo, 'hora da floculação às dezoito horas'.",
      code: "INVALID_TIME_TYPE"
    };
  }

  const key = stage.operator_input_required[0];
  const expectedStage = stage.id;
  
  // Validate that we're on the correct stage (warning only, still allow)
  if (batch.currentStageId !== expectedStage) {
    console.warn(`logTime: Recording ${key} on stage ${batch.currentStageId}, expected stage ${expectedStage}`);
  }
  
  const measurements = (batch.measurements as any) || {};
  measurements[key] = timeValue;
  
  const inputHistory = measurements._history || [];
  inputHistory.push({ id: generateId(), key, value: timeValue, timestamp: new Date().toISOString(), stageId: batch.currentStageId });
  measurements._history = inputHistory;
  
  await storage.updateBatch(batchId, { measurements });
  
  await storage.logBatchAction({
    batchId,
    stageId: batch.currentStageId,
    action: "log_time",
    details: { [key]: timeValue, timeType }
  });
  
  return { success: true, key, timeValue };
}

/**
 * Calculate maturation end date based on maturation days (defaults to 90).
 * This is the SINGLE SOURCE OF TRUTH for this calculation.
 */
export function getMaturationEndDate(batchStartDate: Date, maturationDays: number = 90): Date {
  const maturationEndDate = new Date(batchStartDate);
  maturationEndDate.setDate(maturationEndDate.getDate() + maturationDays);
  return maturationEndDate;
}

/**
 * Record chamber 2 entry date and calculate maturation end date
 * This is the centralized function for Stage 19 completion
 * Used by both REST API and Alexa webhook
 */
export async function recordChamber2Entry(
  batchId: number, 
  entryDateValue: string,
  options?: { unit?: string; notes?: string },
  apiCtx?: any
): Promise<{
  success: boolean;
  error?: string;
  code?: string;
  chamber2EntryDate?: Date;
  maturationEndDate?: Date;
  maturationEndDateISO?: string;
}> {
  const batch = await storage.getBatch(batchId);
  if (!batch) {
    return { success: false, error: "Lote não encontrado", code: "BATCH_NOT_FOUND" };
  }
  
  const batchRm = getRecipeForBatch(batch);
  const maturationDays = batchRm.getMaturationDays();
  const maturationMaxDays = batchRm.getMaturationMaxDays();
  
  // Warn if not on the expected final transfer stage (non-blocking)
  const currentStageDef = batchRm.getStage(batch.currentStageId);
  if (!currentStageDef?.operator_input_required?.includes('chamber_2_entry_date')) {
    console.warn(`recordChamber2Entry: Stage ${batch.currentStageId} does not expect chamber_2_entry_date`);
  }
  
  const entryDate = new Date(entryDateValue);
  const maturationEndDate = getMaturationEndDate(new Date(batch.startedAt), maturationDays);
  const maturationEndDateISO = maturationEndDate.toISOString();
  const maturationMaxEndDate = getMaturationEndDate(new Date(batch.startedAt), maturationMaxDays);
  
  const measurements = (batch.measurements as any) || {};
  measurements["chamber_2_entry_date"] = entryDateValue;
  
  const inputHistory = measurements._history || [];
  const historyEntry: Record<string, any> = { 
    id: generateId(),
    key: "chamber_2_entry_date", 
    value: entryDateValue, 
    timestamp: new Date().toISOString(), 
    stageId: batch.currentStageId 
  };
  if (options?.unit) historyEntry.unit = options.unit;
  if (options?.notes) historyEntry.notes = options.notes;
  inputHistory.push(historyEntry);
  measurements._history = inputHistory;
  
  const alerts = (batch.scheduledAlerts as Record<string, any>) || {};
  if (apiCtx && Object.keys(alerts).length > 0) {
    try {
      await cancelAllBatchReminders(apiCtx, alerts);
    } catch (e) {
      console.warn(`[recordChamber2Entry] Failed to cancel reminders: ${e}`);
    }
  }

  await storage.updateBatch(batchId, { 
    measurements,
    chamber2EntryDate: entryDate,
    maturationEndDate: maturationEndDate,
    maturationMaxEndDate: maturationMaxEndDate,
    status: "completed",
    completedAt: new Date(),
    scheduledAlerts: {},
    activeTimers: [],
    activeReminders: []
  });
  
  await storage.logBatchAction({
    batchId,
    stageId: batch.currentStageId,
    action: "log_date",
    details: { 
      chamber_2_entry_date: entryDateValue, 
      maturationEndDate: maturationEndDateISO 
    }
  });

  await storage.logBatchAction({
    batchId,
    stageId: batch.currentStageId,
    action: "complete",
    details: { 
      reason: "chamber_2_entry_registered",
      maturationEndDate: maturationEndDateISO
    }
  });
  
  return { 
    success: true, 
    chamber2EntryDate: entryDate,
    maturationEndDate: maturationEndDate,
    maturationEndDateISO: maturationEndDateISO
  };
}

/**
 * @deprecated Use recordChamber2Entry instead
 * Kept for backward compatibility - delegates to recordChamber2Entry
 */
export async function logDate(batchId: number, dateValue: string, dateType?: string) {
  if (dateType !== 'chamber_2_entry' && dateType !== 'chamber2') {
    return { 
      success: false, 
      error: "Tipo de data inválido. Use: entrada câmara 2.",
      code: "INVALID_DATE_TYPE"
    };
  }
  
  const result = await recordChamber2Entry(batchId, dateValue);
  
  if (!result.success) {
    return result;
  }
  
  return { 
    success: true, 
    key: 'chamber_2_entry_date', 
    dateValue, 
    maturationEndDate: result.maturationEndDateISO 
  };
}


/**
 * Returns a hint with ALL calculated ingredients for the batch start announcement.
 * Recipe-agnostic: reads ingredient definitions (name, unit) directly from the recipe,
 * so no recipeId or stageId is hardcoded here.
 */
export function getAllCalculatedInputsHint(batch: any, rm: RecipeManager): string {
  const calculatedInputs = (batch.calculatedInputs as Record<string, number>) || {};
  const recipeInputs = rm.getRecipeDetail().inputs;

  const parts: string[] = [];
  for (const input of recipeInputs) {
    if (input.id === 'MILK') continue; // leite bruto não é insumo calculado
    const value = calculatedInputs[input.id];
    if (value != null && value > 0) {
      // Format: avoid unnecessary decimals (e.g. 6.0 → "6", 13.2 → "13,2")
      const formatted = Number.isInteger(value)
        ? String(value)
        : value.toFixed(1).replace('.', ',');
      parts.push(`${formatted} ${input.unit} de ${input.name}`);
    }
  }

  if (parts.length === 0) return '';
  if (parts.length === 1) return ` Você vai precisar de ${parts[0]}.`;
  const last = parts.pop();
  return ` Você vai precisar de ${parts.join(', ')} e ${last}.`;
}

/**
 * Returns calculated-input quantity hints for the given stage (e.g. "Use 65 ml de coalho.").
 * Used by both buildStageSpeech and the Alexa buildStageGuidance path in routes.ts.
 */
export function getCalculatedInputHint(batch: any, stageId: number): string {
  const calculatedInputs = (batch.calculatedInputs as Record<string, number>) || {};
  const recipeId = batch.recipeId || 'QUEIJO_NETE';
  const hints: string[] = [];
  // Resolved dynamically from this batch's own recipe/version rather than hardcoded
  // stage numbers, so hints stay correct even if a future version inserts/reorders
  // stages (e.g. the WHEY_TO_REMOVE stage shifted from id 15 to 16 in Nina v2).
  const rm = getRecipeForBatch(batch);

  if (recipeId === 'QUEIJO_NETE') {
    // Insertion point for Nete's extra wait stage is at id 10 (v2); all of these
    // stage ids (2-5) sit below it, so they stay stable across versions.
    if (stageId === 3 && calculatedInputs.FERMENT_KL) {
      hints.push(`Use ${calculatedInputs.FERMENT_KL} ml de fermento KL.`);
    }
    if (stageId === 4) {
      const lr = calculatedInputs.FERMENT_LR;
      const dx = calculatedInputs.FERMENT_DX;
      if (lr && dx) hints.push(`Use ${lr} ml de fermento LR e ${dx} ml de DX.`);
    }
    if (stageId === 5 && calculatedInputs.RENNET) {
      hints.push(`Use ${calculatedInputs.RENNET} ml de coalho.`);
    }
  } else if (recipeId === 'QUEIJO_NINA') {
    // Insertion point for Nina's extra wait stage is at id 14 (v2). Stages 2, 3, 7,
    // 9, 10 sit below it and stay stable; WHEY_TO_REMOVE's stage (15 in v1, 16 in
    // v2) is resolved dynamically since it sits right at the shift boundary.
    if (stageId === 2) {
      const dx = calculatedInputs.FERMENT_DX;
      const ht = calculatedInputs.FERMENT_HT;
      const rennet = calculatedInputs.RENNET;
      const smallTank = calculatedInputs.SMALL_TANK_MILK;
      if (dx && ht) hints.push(`Use ${dx} ml de fermento DX e ${ht} ml de fermento HT.`);
      if (rennet) hints.push(`Use ${rennet} ml de coalho.`);
      if (smallTank) hints.push(`Leite para tanque pequeno: ${smallTank} litros (10% do total).`);
    }
    if (stageId === 3 && calculatedInputs.SMALL_TANK_MILK) {
      hints.push(`Retirar ${calculatedInputs.SMALL_TANK_MILK} litros de leite para o tanque pequeno.`);
    }
    if (stageId === 7) {
      const dx = calculatedInputs.FERMENT_DX;
      const ht = calculatedInputs.FERMENT_HT;
      if (dx && ht) hints.push(`Use ${dx} ml de DX e ${ht} ml de HT.`);
    }
    if (stageId === 9 && calculatedInputs.RENNET) {
      hints.push(`Use ${calculatedInputs.RENNET} ml de coalho.`);
    }
    if (stageId === 10 && calculatedInputs.HOT_WATER) {
      hints.push(`Aquecer ${calculatedInputs.HOT_WATER} litros de água a 60°C.`);
    }
    const wheyStageId = rm.getStageByVolumeSource('WHEY_TO_REMOVE')?.id ?? 15;
    if (stageId === wheyStageId && calculatedInputs.WHEY_TO_REMOVE) {
      hints.push(`Retirar ${calculatedInputs.WHEY_TO_REMOVE} litros de soro.`);
    }
  }

  return hints.length > 0 ? ' ' + hints.join(' ') : '';
}

export function buildStageSpeech(batch: any, stageId: number): string {
  const stage = getRecipeForBatch(batch).getStage(stageId);
  if (!stage) return `Etapa ${stageId} não encontrada.`;
  
  const parts: string[] = [];
  
  // Stage name
  parts.push(`Etapa ${stageId}: ${stage.name}.`);
  
  // Inject calculated quantities via shared helper
  const hint = getCalculatedInputHint(batch, stageId);
  if (hint) parts.push(hint.trim());
  
  // Add instructions (first 2 if long)
  if (stage.instructions && stage.instructions.length > 0) {
    const instructionText = stage.instructions.slice(0, 2).join(' ');
    parts.push(instructionText);
  }
  
  // Add timer info if present
  if (stage.timer) {
    const durationMinutes = getTimerDurationMinutes(stage);
    if (durationMinutes > 0) {
      if (TEST_MODE) {
        parts.push(`Timer de ${durationMinutes} minuto(s) iniciado (modo teste).`);
      } else if (stage.timer.duration_hours) {
        parts.push(`Timer de ${stage.timer.duration_hours} hora(s) iniciado.`);
      } else {
        parts.push(`Timer de ${durationMinutes} minutos iniciado.`);
      }
    }
  }
  
  return parts.join(' ');
}

function reconstructMeasurements(history: any[]): Record<string, any> {
  const m: Record<string, any> = { _history: history };
  const phMeasurements: any[] = [];

  history.forEach((entry: any) => {
    const { key, value, stageId, timestamp } = entry;
    m[key] = value;
    if (key === 'ph_value' && stageId === 13) {
      m['initial_ph'] = value;
    }
    if (key === 'ph_value') {
      phMeasurements.push({ value, timestamp, stageId });
    }
  });

  if (phMeasurements.length > 0) {
    m.ph_measurements = phMeasurements;
  }

  return m;
}

export async function rollbackBatch(batchId: number, apiCtx?: ApiContext | null): Promise<{
  success: boolean;
  batch?: any;
  targetStageId?: number;
  error?: string;
  code?: string;
}> {
  const batch = await storage.getBatch(batchId);
  if (!batch) {
    return { success: false, error: "Lote não encontrado", code: "BATCH_NOT_FOUND" };
  }

  if (batch.status === "completed") {
    return { success: false, error: "O lote já foi concluído e não pode ser revertido.", code: "BATCH_COMPLETED" };
  }

  if (batch.currentStageId <= 3) {
    return {
      success: false,
      error: "Não é possível voltar a partir das etapas 1, 2 ou 3. O retorno é permitido apenas a partir da etapa 4.",
      code: "ROLLBACK_NOT_ALLOWED"
    };
  }

  const rm = getRecipeForBatch(batch);

  let targetStageId = batch.currentStageId - 1;
  while (targetStageId > 0) {
    const s = rm.getStage(targetStageId);
    if (s && s.type !== "system") break;
    targetStageId--;
  }

  if (targetStageId <= 0) {
    return { success: false, error: "Não há etapa anterior válida.", code: "ROLLBACK_NOT_ALLOWED" };
  }

  const currentStageId = batch.currentStageId;

  let activeTimers = (batch.activeTimers as any[]) || [];
  activeTimers = activeTimers.filter((t: any) => t.stageId !== currentStageId);

  let activeReminders = (batch.activeReminders as any[]) || [];
  activeReminders = activeReminders.filter((r: any) => r.stageId !== currentStageId);

  let scheduledAlerts = { ...((batch.scheduledAlerts as Record<string, any>) || {}) };
  const stageKey = `stage_${currentStageId}`;
  if (scheduledAlerts[stageKey]) {
    if (apiCtx) {
      await cancelReminder(apiCtx, scheduledAlerts[stageKey].reminderId);
    }
    delete scheduledAlerts[stageKey];
  }

  const measurements = (batch.measurements as Record<string, any>) || {};
  const oldHistory: any[] = measurements._history || [];
  const newHistory = oldHistory.filter((entry: any) =>
    entry.stageId !== currentStageId && entry.stageId !== targetStageId
  );
  const newMeasurements = reconstructMeasurements(newHistory);

  const updatedHistory = [...((batch.history as any[]) || [])];
  updatedHistory.push({
    action: "rollback",
    stageId: currentStageId,
    targetStageId,
    timestamp: new Date().toISOString(),
  });

  const updates: any = {
    currentStageId: targetStageId,
    activeTimers,
    activeReminders,
    scheduledAlerts,
    measurements: newMeasurements,
    history: updatedHistory,
  };

  if (rm.isLoopStage(currentStageId)) {
    updates.turningCyclesCount = 0;
  }

  const updatedBatch = await storage.updateBatch(batchId, updates);

  await storage.logBatchAction({
    batchId,
    stageId: targetStageId,
    action: "rollback",
    details: { from: currentStageId, to: targetStageId },
  });

  console.log(`[rollbackBatch] batch=${batchId} from=${currentStageId} to=${targetStageId}`);

  return { success: true, batch: updatedBatch, targetStageId };
}

// ─── Post-Completion Edit ───────────────────────────────────────────────────

export interface PhMeasurementEdit {
  index?: number; // undefined = new entry to append
  value: number;
  timestamp?: string; // ISO string, optional
}

export interface EditCompletedBatchPayload {
  measurements?: {
    // milk_volume_l excluded: use topLevel.milkVolumeL to keep top-level and measurements in sync
    milk_temperature_c?: number;
    milk_ph?: number;
    ferment_lr_dx_add_time_iso?: string;
    ferment_kl_coalho_add_time_iso?: string;
    flocculation_time?: string;
    cut_point_time?: string;
    initial_ph?: number;
    pieces_quantity?: number;
    press_start_time?: string;
    ph_measurements?: PhMeasurementEdit[];
    ph_measurement_deletions?: number[];
    brine_entry_time_iso?: string;
    shelf_start_time_iso?: string;
  };
  // Accepts flat { KEY: number } or nested { KEY: { value: number } } — normalized in service
  calculatedInputs?: Record<string, number | { value: number }>;
  topLevel?: {
    milkVolumeL?: number;
    turningCyclesCount?: number;
    chamber2EntryDate?: string;
    maturationEndDate?: string;
    maturationMaxEndDate?: string;
    chamber2ExitDate?: string | null;
  };
}

export async function editCompletedBatch(
  batchId: number,
  payload: EditCompletedBatchPayload
): Promise<{ success: boolean; batch?: any; error?: string; code?: string }> {
  const batch = await storage.getBatch(batchId);
  if (!batch) return { success: false, error: "Lote não encontrado", code: "BATCH_NOT_FOUND" };
  if (batch.status !== 'completed') {
    return { success: false, error: "Apenas lotes concluídos podem ser editados.", code: "BATCH_NOT_COMPLETED" };
  }

  const now = new Date().toISOString();
  const measurements = { ...((batch.measurements as any) || {}) };
  const history: any[] = [...(measurements._history || [])];
  const fieldsEdited: string[] = [];
  const isNina = ((batch as any).recipeId || 'QUEIJO_NETE') === 'QUEIJO_NINA';
  const rm = getRecipeForBatch(batch);
  // Resolved dynamically from this batch's own recipe/version rather than hardcoded
  // per-recipe stage numbers, so edits keep pointing at the right stage even after
  // stages are inserted/renumbered for future batches.
  const loopStageId = rm.getLoopStageId() ?? (isNina ? 21 : 15);
  const camStageId = rm.getStageByOperatorInput('chamber_2_entry_date')?.id ?? (isNina ? 25 : 19);

  function recordEdit(key: string, newValue: any, previousValue: any, stageId: number) {
    history.push({ key, value: newValue, previousValue, stageId, timestamp: now, action: 'post_completion_edit', editedVia: 'web' });
    fieldsEdited.push(key);
  }

  const updates: Record<string, any> = {};

  // --- measurements patch ---
  if (payload.measurements) {
    const m = payload.measurements;

    // Every measurement key either recipe can possibly store. Which stage each
    // one belongs to is resolved dynamically per-batch via getStageForMeasurementKey,
    // so this list needs no per-recipe/per-version branching — a key simply resolves
    // to `undefined` (and is skipped) if this batch's recipe/version doesn't have it.
    const editableKeys = [
      'milk_temperature_c', 'milk_ph',
      'ferment_add_time', 'rennet_add_time',
      'ferment_lr_dx_add_time_iso', 'ferment_kl_coalho_add_time_iso',
      'flocculation_time', 'cut_point_time',
      'initial_ph', 'pieces_quantity',
      'press_start_time',
      'brine_entry_time_iso', 'shelf_start_time_iso',
    ];

    for (const key of editableKeys) {
      const newVal = (m as any)[key];
      if (newVal === undefined) continue;
      const stageId = rm.getStageForMeasurementKey(key)?.id;
      if (stageId === undefined) continue; // this recipe/version doesn't have this field
      if (newVal !== measurements[key]) {
        recordEdit(key, newVal, measurements[key], stageId);
        measurements[key] = newVal;
      }
    }

    const hasPhEdits = m.ph_measurements && m.ph_measurements.length > 0;
    const hasPhDeletions = m.ph_measurement_deletions && m.ph_measurement_deletions.length > 0;
    if (hasPhEdits || hasPhDeletions) {
      // Prefer existing ph_measurements array; for legacy batches without it, reconstruct from _history.
      // Nina historical batches may have stored pH at stageId 20 (old recipe); current recipe uses 21.
      const altLoopStageId = isNina ? 20 : null;
      let phArr: any[] = measurements.ph_measurements
        ? [...measurements.ph_measurements]
        : history
            .filter((h: any) => (h.key === 'ph_value' || h.key === 'ph_measurement') &&
              (h.stageId === loopStageId || (altLoopStageId && h.stageId === altLoopStageId)))
            .map((h: any) => ({ value: h.value, stageId: loopStageId, timestamp: h.timestamp }));

      if (hasPhEdits) {
        for (const edit of m.ph_measurements) {
          if (edit.index !== undefined) {
            // Edit existing entry by index
            if (edit.index >= 0 && edit.index < phArr.length) {
              const prevValue = phArr[edit.index].value;
              const prevTimestamp = phArr[edit.index].timestamp;
              const valueChanged = edit.value !== prevValue;
              const tsChanged = edit.timestamp !== undefined && edit.timestamp !== prevTimestamp;
              if (valueChanged || tsChanged) {
                recordEdit(`ph_measurement_${edit.index}`, edit.value, prevValue, loopStageId);
                phArr[edit.index] = {
                  ...phArr[edit.index],
                  value: edit.value,
                  ...(edit.timestamp !== undefined ? { timestamp: edit.timestamp } : {}),
                };
              }
            }
          } else {
            // New entry — append to array and record in history
            const ts = edit.timestamp ?? now;
            phArr.push({ value: edit.value, stageId: loopStageId, timestamp: ts });
            recordEdit('ph_measurement', edit.value, null, loopStageId);
          }
        }
      }
      if (hasPhDeletions) {
        const toDelete = new Set(m.ph_measurement_deletions);
        const prevPhArr = [...phArr];
        phArr = phArr.filter((_: any, i: number) => !toDelete.has(i));
        for (const delIdx of m.ph_measurement_deletions) {
          if (delIdx >= 0 && delIdx < prevPhArr.length) {
            recordEdit(`ph_measurement_delete_${delIdx}`, null, prevPhArr[delIdx].value, loopStageId);
          }
        }
      }
      measurements.ph_measurements = phArr;
      measurements.ph_value = phArr.length > 0 ? phArr[phArr.length - 1].value : null;
    }
  }

  // --- calculatedInputs patch ---
  if (payload.calculatedInputs && Object.keys(payload.calculatedInputs).length > 0) {
    const currentCalc = { ...((batch.calculatedInputs as any) || {}) };
    for (const [key, rawValue] of Object.entries(payload.calculatedInputs)) {
      // Normalize: accepts flat number { KEY: 65 } OR nested { KEY: { value: 65 } }
      const value = typeof rawValue === 'object' && rawValue !== null && 'value' in rawValue
        ? (rawValue as { value: number }).value
        : rawValue as number;
      if (value !== undefined && value !== currentCalc[key]) {
        recordEdit(`calc_${key}`, value, currentCalc[key], 2);
        currentCalc[key] = value;
      }
    }
    updates.calculatedInputs = currentCalc;
  }

  // --- topLevel patch ---
  if (payload.topLevel) {
    const t = payload.topLevel;
    if (t.milkVolumeL !== undefined && t.milkVolumeL !== Number(batch.milkVolumeL)) {
      recordEdit('milkVolumeL', t.milkVolumeL, Number(batch.milkVolumeL), 1);
      updates.milkVolumeL = t.milkVolumeL;
      measurements.milk_volume_l = t.milkVolumeL;
    }
    if (t.turningCyclesCount !== undefined && t.turningCyclesCount !== (batch as any).turningCyclesCount) {
      recordEdit('turningCyclesCount', t.turningCyclesCount, (batch as any).turningCyclesCount, loopStageId);
      updates.turningCyclesCount = t.turningCyclesCount;
    }
    if (t.chamber2EntryDate !== undefined) {
      // Extract date-part from ISO string directly (no TZ conversion) — matches frontend parseDateOnly
      const currentStr = batch.chamber2EntryDate
        ? new Date(batch.chamber2EntryDate).toISOString().split("T")[0]
        : null;
      if (t.chamber2EntryDate !== currentStr) {
        recordEdit('chamber2EntryDate', t.chamber2EntryDate, currentStr, camStageId);
        updates.chamber2EntryDate = new Date(t.chamber2EntryDate);
      }
    }
    if (t.maturationEndDate !== undefined) {
      const currentStr = batch.maturationEndDate
        ? new Date(batch.maturationEndDate).toISOString().split("T")[0]
        : null;
      if (t.maturationEndDate !== currentStr) {
        recordEdit('maturationEndDate', t.maturationEndDate, currentStr, camStageId);
        updates.maturationEndDate = new Date(t.maturationEndDate);
      }
    }
    if (t.maturationMaxEndDate !== undefined) {
      const currentStr = (batch as any).maturationMaxEndDate
        ? new Date((batch as any).maturationMaxEndDate).toISOString().split("T")[0]
        : null;
      if (t.maturationMaxEndDate !== currentStr) {
        recordEdit('maturationMaxEndDate', t.maturationMaxEndDate, currentStr, camStageId);
        updates.maturationMaxEndDate = new Date(t.maturationMaxEndDate);
      }
    }
    // chamber2ExitDate: update WITHOUT recordEdit — must not trigger "Editado" badge
    if (t.chamber2ExitDate !== undefined) {
      const currentStr = (batch as any).chamber2ExitDate
        ? new Date((batch as any).chamber2ExitDate).toISOString().split("T")[0]
        : null;
      if (t.chamber2ExitDate !== currentStr) {
        updates.chamber2ExitDate = t.chamber2ExitDate ? new Date(t.chamber2ExitDate) : null;
      }
    }
  }

  // chamber2ExitDate updates bypass recordEdit, so check updates separately
  const hasSilentUpdates = 'chamber2ExitDate' in updates;

  if (fieldsEdited.length === 0 && !hasSilentUpdates) {
    return { success: true, batch };
  }

  if (fieldsEdited.length > 0) {
    measurements._history = history;
    updates.measurements = measurements;
  }

  const updatedBatch = await storage.updateBatch(batchId, updates);

  if (fieldsEdited.length > 0) {
    await storage.logBatchAction({
      batchId,
      stageId: batch.currentStageId,
      action: 'post_completion_edit',
      details: { fieldsEdited, editedVia: 'web' }
    });
    console.log(`[editCompletedBatch] batch=${batchId} fieldsEdited=${fieldsEdited.join(',')}`);
  }

  return { success: true, batch: updatedBatch };
}
