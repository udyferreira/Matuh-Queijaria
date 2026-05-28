import { storage } from "./storage";
import { recipeManager, RecipeManager, getRecipeForBatch, getTimerDurationMinutes, getIntervalDurationMinutes, getWaitSpecForStage, getWaitSpecForStageData, TEST_MODE } from "./recipe";
import { getRecipeSnapshotForBatch } from "./recipeService";
import { CHEESE_TYPES } from "@shared/schema";
import { randomBytes } from "crypto";
import { ApiContext, ScheduledAlert, scheduleReminderForWait, cancelReminder, cancelAllBatchReminders } from "./alexaReminders";

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
  
  // Look up recipe in DB (primary) or fall back to CHEESE_TYPES for Alexa backward compat
  const recipeSnapshotData = await getRecipeSnapshotForBatch(recipeId);
  if (!recipeSnapshotData) {
    // Fallback: check legacy CHEESE_TYPES for Alexa backward compat
    const cheeseType = CHEESE_TYPES[recipeId as keyof typeof CHEESE_TYPES];
    if (!cheeseType) {
      return {
        success: false,
        error: `Receita não encontrada: ${recipeId}`,
        code: "INVALID_CHEESE_TYPE"
      };
    }
  }
  
  // Build a RecipeManager from the snapshot for input calculations
  const rm = recipeSnapshotData
    ? RecipeManager.fromData(recipeSnapshotData.snapshot)
    : recipeManager;
  
  const inputs = rm.calculateInputs(milkVolumeL);
  
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
    recipeName: recipeSnapshotData?.name || recipeId.replace('QUEIJO_', ''),
    recipeSnapshot: recipeSnapshotData?.snapshot || null,
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

    if (batch.currentStageId === 15) {
      const freshBatch = await storage.getBatch(batchId);
      if (freshBatch) {
        const freshMeasurements = (freshBatch.measurements as Record<string, any>) || {};
        const turningCount = (freshBatch as any).turningCyclesCount || 0;
        const timestamp = new Date().toISOString();
        const historyEntries = [
          { key: 'turning_cycles_count', value: turningCount, stageId: 15, timestamp },
          { key: 'loop_exit_reason', value: 'ph_reached', stageId: 15, timestamp }
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
    if (!alertAlreadyFired) {
      await cancelReminder(apiCtx, scheduledAlerts[prevKey].reminderId);
    } else {
      console.log(`[advanceBatch] Stage ${currentStage.id} reminder already fired (dueAt=${scheduledAlerts[prevKey].dueAtISO}). Skipping cancelReminder API call.`);
    }
    delete scheduledAlerts[prevKey];
  }

  const updates: any = {
    currentStageId: nextStage.id,
    activeTimers,
    activeReminders,
    scheduledAlerts
  };

  if (nextStage.id === 15) {
    const phTimerMinutes = TEST_MODE ? 2 : 90;
    const timerDesc = TEST_MODE ? "2 minuto(s) (TESTE)" : "1 hora e 30 minutos";
    activeTimers.push({
      id: generateId(),
      stageId: 15,
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
      const intervalDesc = TEST_MODE ? "1 minuto (TESTE)" : `${nextStage.timer.interval_hours} horas`;
      activeReminders.push({
        id: generateId(),
        stageId: nextStage.id,
        type: "interval",
        intervalHours: intervalMinutes / 60,
        nextTrigger: new Date(Date.now() + intervalMinutes * 60000).toISOString(),
        acknowledged: false,
        description: `Verificar pH a cada ${intervalDesc}`
      });
      updates.activeReminders = activeReminders;
    }
    
    if (durationMinutes > 0) {
      const blocking = nextStage.timer.blocking === true;
      const timer = nextStage.timer as any;
      const timerDesc = TEST_MODE 
        ? `${durationMinutes} minuto(s) (TESTE)` 
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
      ? (1/60)
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

  if (nextStage.id === 4 && !measurements.ferment_lr_dx_add_time_iso) {
    measurements.ferment_lr_dx_add_time_iso = nowIso;
    const mHistory = measurements._history || [];
    mHistory.push({ key: 'ferment_lr_dx_add_time_iso', value: nowIso, stageId: 4, timestamp: nowIso });
    measurements._history = mHistory;
    touchedMeasurements = true;
  }

  if (nextStage.id === 5 && !measurements.ferment_kl_coalho_add_time_iso) {
    measurements.ferment_kl_coalho_add_time_iso = nowIso;
    const mHistory = measurements._history || [];
    mHistory.push({ key: 'ferment_kl_coalho_add_time_iso', value: nowIso, stageId: 5, timestamp: nowIso });
    measurements._history = mHistory;
    touchedMeasurements = true;
  }

  if (nextStage.id === 17 && !measurements.brine_entry_time_iso) {
    measurements.brine_entry_time_iso = nowIso;
    const mHistory = measurements._history || [];
    mHistory.push({ key: 'brine_entry_time_iso', value: nowIso, stageId: 17, timestamp: nowIso });
    measurements._history = mHistory;
    touchedMeasurements = true;
  }

  if (nextStage.id === 18 && !measurements.shelf_start_time_iso) {
    measurements.shelf_start_time_iso = nowIso;
    const mHistory = measurements._history || [];
    mHistory.push({ key: 'shelf_start_time_iso', value: nowIso, stageId: 18, timestamp: nowIso });
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
      const reminderResult = await scheduleReminderForWait(
        apiCtx,
        { id: batchId, recipeId: batch.recipeId },
        nextStage.id,
        waitSpec.seconds,
        undefined,
        nextStage.name,
        batchRecipeManager.getRecipeName()
      );
      if (reminderResult.reminderId) {
        scheduledAlerts[newKey] = {
          reminderId: reminderResult.reminderId,
          stageId: nextStage.id,
          dueAtISO: new Date(Date.now() + waitSpec.seconds * 1000).toISOString(),
          kind: waitSpec.kind
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
      recipeName: (batch as any).recipeName || rm.getRecipeName(),
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
  
  const DEDUP_WINDOW_MS = 30_000;
  if (stageId === 15) {
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
  
  // Stage 13: Store as initial_ph (per recipe.yml stored_values)
  if (stageId === 13) {
    measurements.initial_ph = phValue;
    inputHistory.push({ key: 'initial_ph', value: phValue, timestamp, stageId: 13 });
    
    if (piecesQuantity !== undefined) {
      measurements.pieces_quantity = piecesQuantity;
      inputHistory.push({ key: 'pieces_quantity', value: piecesQuantity, timestamp, stageId: 13 });
    }
  } else {
    // For loop stages (15) and others, use ph_value and add to history
    measurements.ph_value = phValue;
    const phHistory = measurements.ph_measurements || [];
    phHistory.push({ value: phValue, timestamp, stageId });
    measurements.ph_measurements = phHistory;
    inputHistory.push({ key: 'ph_measurement', value: phValue, timestamp, stageId });
  }
  
  measurements._history = inputHistory;
  const updates: any = { measurements };
  
  let turningCyclesCount: number | undefined;
  let shouldExitLoop = false;
  let phReachedTarget = false;
  
  // Stage 15: Increment turning cycles count, check loop exit, and manage timer
  if (stageId === 15) {
    const currentCount = (batch as any).turningCyclesCount || 0;
    turningCyclesCount = currentCount + 1;
    updates.turningCyclesCount = turningCyclesCount;
    
    // Check if pH reached target (loop exit condition)
    if (phValue < TARGET_PH) {
      shouldExitLoop = true;
      phReachedTarget = true;
    }
    
    // Manage stage 15 timer: cancel current, create new if pH not reached
    let activeTimers = (batch.activeTimers as any[]) || [];
    activeTimers = activeTimers.filter(t => t.stageId !== 15);
    
    if (!phReachedTarget) {
      const phTimerMinutes = TEST_MODE ? 2 : 90;
      const timerDesc = TEST_MODE ? "2 minuto(s) (TESTE)" : "1 hora e 30 minutos";
      activeTimers.push({
        id: generateId(),
        stageId: 15,
        durationMinutes: phTimerMinutes,
        startTime: new Date().toISOString(),
        endTime: new Date(Date.now() + phTimerMinutes * 60000).toISOString(),
        description: timerDesc,
        blocking: false
      });
      console.log(`[logPh] Stage 15: pH ${phValue} not ideal. New 1h30 timer started.`);
    } else {
      console.log(`[logPh] Stage 15: pH ${phValue} reached target. Timer cleared.`);
      // Also clear the DB record of the Alexa scheduled alert so advanceBatch
      // does not attempt to cancel an already-fired reminder via the Alexa API
      const currentAlerts = { ...((batch as any).scheduledAlerts || {}) };
      if (currentAlerts['stage_15']) {
        delete currentAlerts['stage_15'];
        updates.scheduledAlerts = currentAlerts;
        console.log(`[logPh] Stage 15: scheduledAlerts.stage_15 cleared from DB on pH target reached.`);
      }
    }
    updates.activeTimers = activeTimers;
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
  
  const normalizeTimeType = (s?: string): string | null => {
    if (!s || s === '?' || !s.trim()) return null;
    return s.toLowerCase().trim()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z]/g, '');
  };

  const timeTypeMapping: Record<string, { key: string; expectedStage: number }> = {
    'flocculation': { key: 'flocculation_time', expectedStage: 6 },
    'cut': { key: 'cut_point_time', expectedStage: 7 },
    'cut_point': { key: 'cut_point_time', expectedStage: 7 },
    'press': { key: 'press_start_time', expectedStage: 14 },
    'press_start': { key: 'press_start_time', expectedStage: 14 },
    'floculacao': { key: 'flocculation_time', expectedStage: 6 },
    'flocoacao': { key: 'flocculation_time', expectedStage: 6 },
    'flucoacao': { key: 'flocculation_time', expectedStage: 6 },
    'fortunacao': { key: 'flocculation_time', expectedStage: 6 },
    'flocuacao': { key: 'flocculation_time', expectedStage: 6 },
    'corte': { key: 'cut_point_time', expectedStage: 7 },
    'pontodecorte': { key: 'cut_point_time', expectedStage: 7 },
    'ponto': { key: 'cut_point_time', expectedStage: 7 },
    'prensa': { key: 'press_start_time', expectedStage: 14 },
    'prensagem': { key: 'press_start_time', expectedStage: 14 },
  };

  const stageInferMap: Record<number, { key: string; expectedStage: number }> = {
    6: { key: 'flocculation_time', expectedStage: 6 },
    7: { key: 'cut_point_time', expectedStage: 7 },
    14: { key: 'press_start_time', expectedStage: 14 },
  };
  
  const normalized = normalizeTimeType(timeType);
  let mapping = normalized ? timeTypeMapping[normalized] : null;

  if (!mapping && normalized) {
    if (normalized.includes('floc') || normalized.includes('fluc') || normalized.includes('fort')) {
      mapping = { key: 'flocculation_time', expectedStage: 6 };
    } else if (normalized.includes('cort')) {
      mapping = { key: 'cut_point_time', expectedStage: 7 };
    } else if (normalized.includes('prens') || normalized.includes('prensa')) {
      mapping = { key: 'press_start_time', expectedStage: 14 };
    }
  }

  if (!mapping) {
    mapping = stageInferMap[batch.currentStageId] || null;
    if (mapping) {
      console.log(`[logTime] Inferred timeType from stage ${batch.currentStageId} => ${mapping.key} (raw timeType: "${timeType}")`);
    }
  }
  
  if (!mapping) {
    return { 
      success: false, 
      error: "Tipo de horário inválido. Use: floculação, corte, ou prensa. Se estiver na etapa correta, diga apenas 'hora às HH:MM'.",
      code: "INVALID_TIME_TYPE"
    };
  }
  
  const { key, expectedStage } = mapping;
  
  // Validate that we're on the correct stage (warning only, still allow)
  if (batch.currentStageId !== expectedStage) {
    console.warn(`logTime: Recording ${key} on stage ${batch.currentStageId}, expected stage ${expectedStage}`);
  }
  
  const measurements = (batch.measurements as any) || {};
  measurements[key] = timeValue;
  
  const inputHistory = measurements._history || [];
  inputHistory.push({ key, value: timeValue, timestamp: new Date().toISOString(), stageId: batch.currentStageId });
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
 * Calculate maturation end date: 90 days from batch start date
 * This is the SINGLE SOURCE OF TRUTH for this calculation
 */
export function getMaturationEndDate(batchStartDate: Date): Date {
  const maturationEndDate = new Date(batchStartDate);
  maturationEndDate.setDate(maturationEndDate.getDate() + 90);
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
  
  const expectedStage = 19;
  if (batch.currentStageId !== expectedStage) {
    console.warn(`recordChamber2Entry: Recording on stage ${batch.currentStageId}, expected stage ${expectedStage}`);
  }
  
  const entryDate = new Date(entryDateValue);
  const maturationEndDate = getMaturationEndDate(new Date(batch.startedAt));
  const maturationEndDateISO = maturationEndDate.toISOString();
  
  const measurements = (batch.measurements as any) || {};
  measurements["chamber_2_entry_date"] = entryDateValue;
  
  const inputHistory = measurements._history || [];
  const historyEntry: Record<string, any> = { 
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
 * Build speech for a stage including instructions and calculated quantities
 * Used when advancing to provide complete guidance
 */
export function buildStageSpeech(batch: any, stageId: number): string {
  const stage = getRecipeForBatch(batch).getStage(stageId);
  if (!stage) return `Etapa ${stageId} não encontrada.`;
  
  const parts: string[] = [];
  
  // Stage name
  parts.push(`Etapa ${stageId}: ${stage.name}.`);
  
  // Add calculated quantities for stages that use them
  const calculatedInputs = batch.calculatedInputs || {};
  
  // Stage 3: Fermento KL
  if (stageId === 3 && calculatedInputs.FERMENT_KL) {
    parts.push(`Use ${calculatedInputs.FERMENT_KL} ml de fermento KL.`);
  }
  
  // Stage 4: Fermentos LR e DX
  if (stageId === 4) {
    const lr = calculatedInputs.FERMENT_LR;
    const dx = calculatedInputs.FERMENT_DX;
    if (lr && dx) {
      parts.push(`Use ${lr} ml de fermento LR e ${dx} ml de DX.`);
    }
  }
  
  // Stage 5: Coalho (Rennet)
  if (stageId === 5 && calculatedInputs.RENNET) {
    parts.push(`Use ${calculatedInputs.RENNET} ml de coalho.`);
  }
  
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

  let targetStageId = batch.currentStageId - 1;
  while (targetStageId > 0) {
    const s = getRecipeForBatch(batch).getStage(targetStageId);
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

  if (currentStageId === 15) {
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
  index: number;
  value: number;
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

  function recordEdit(key: string, newValue: any, previousValue: any, stageId: number) {
    history.push({ key, value: newValue, previousValue, stageId, timestamp: now, action: 'post_completion_edit', editedVia: 'web' });
    fieldsEdited.push(key);
  }

  const updates: Record<string, any> = {};

  // --- measurements patch ---
  if (payload.measurements) {
    const m = payload.measurements;

    const simpleFields: Array<{ key: string; stageId: number }> = [
      { key: 'milk_temperature_c', stageId: 1 },
      { key: 'milk_ph', stageId: 1 },
      { key: 'ferment_lr_dx_add_time_iso', stageId: 4 },
      { key: 'ferment_kl_coalho_add_time_iso', stageId: 5 },
      { key: 'flocculation_time', stageId: 6 },
      { key: 'cut_point_time', stageId: 7 },
      { key: 'initial_ph', stageId: 13 },
      { key: 'pieces_quantity', stageId: 13 },
      { key: 'press_start_time', stageId: 14 },
      { key: 'brine_entry_time_iso', stageId: 17 },
      { key: 'shelf_start_time_iso', stageId: 18 },
    ];

    for (const { key, stageId } of simpleFields) {
      const newVal = (m as any)[key];
      if (newVal !== undefined && newVal !== measurements[key]) {
        recordEdit(key, newVal, measurements[key], stageId);
        measurements[key] = newVal;
      }
    }

    if (m.ph_measurements && m.ph_measurements.length > 0) {
      // Prefer existing ph_measurements array; for legacy batches without it, reconstruct from _history
      let phArr: any[] = measurements.ph_measurements
        ? [...measurements.ph_measurements]
        : history
            .filter((h: any) => (h.key === 'ph_value' || h.key === 'ph_measurement') && h.stageId === 15)
            .map((h: any) => ({ value: h.value, stageId: 15, timestamp: h.timestamp }));

      for (const edit of m.ph_measurements) {
        if (edit.index >= 0 && edit.index < phArr.length) {
          const prev = phArr[edit.index].value;
          if (edit.value !== prev) {
            recordEdit(`ph_measurement_${edit.index}`, edit.value, prev, 15);
            phArr[edit.index] = { ...phArr[edit.index], value: edit.value };
          }
        }
      }
      measurements.ph_measurements = phArr;
      if (phArr.length > 0) {
        measurements.ph_value = phArr[phArr.length - 1].value;
      }
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
      recordEdit('turningCyclesCount', t.turningCyclesCount, (batch as any).turningCyclesCount, 15);
      updates.turningCyclesCount = t.turningCyclesCount;
    }
    if (t.chamber2EntryDate !== undefined) {
      // Extract date-part from ISO string directly (no TZ conversion) — matches frontend parseDateOnly
      const currentStr = batch.chamber2EntryDate
        ? new Date(batch.chamber2EntryDate).toISOString().split("T")[0]
        : null;
      if (t.chamber2EntryDate !== currentStr) {
        recordEdit('chamber2EntryDate', t.chamber2EntryDate, currentStr, 19);
        updates.chamber2EntryDate = new Date(t.chamber2EntryDate);
      }
    }
    if (t.maturationEndDate !== undefined) {
      const currentStr = batch.maturationEndDate
        ? new Date(batch.maturationEndDate).toISOString().split("T")[0]
        : null;
      if (t.maturationEndDate !== currentStr) {
        recordEdit('maturationEndDate', t.maturationEndDate, currentStr, 19);
        updates.maturationEndDate = new Date(t.maturationEndDate);
      }
    }
  }

  if (fieldsEdited.length === 0) {
    return { success: true, batch };
  }

  measurements._history = history;
  updates.measurements = measurements;

  const updatedBatch = await storage.updateBatch(batchId, updates);

  await storage.logBatchAction({
    batchId,
    stageId: batch.currentStageId,
    action: 'post_completion_edit',
    details: { fieldsEdited, editedVia: 'web' }
  });

  console.log(`[editCompletedBatch] batch=${batchId} fieldsEdited=${fieldsEdited.join(',')}`);
  return { success: true, batch: updatedBatch };
}
