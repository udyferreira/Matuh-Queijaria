import { storage } from "./storage";
import { recipeManager, getTimerDurationMinutes, getIntervalDurationMinutes, TEST_MODE } from "./recipe";
import { CHEESE_TYPES } from "@shared/schema";
import { randomBytes } from "crypto";

const generateId = () => randomBytes(8).toString('hex');

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
}

export async function startBatch(params: StartBatchParams): Promise<StartBatchResult> {
  const { milkVolumeL, milkTemperatureC, milkPh, recipeId: rawRecipeId = "QUEIJO_NETE" } = params;
  
  // Normalize recipeId to uppercase for CHEESE_TYPES lookup
  const recipeId = rawRecipeId.toUpperCase();
  
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
  
  const cheeseType = CHEESE_TYPES[recipeId as keyof typeof CHEESE_TYPES];
  if (!cheeseType) {
    return {
      success: false,
      error: `Tipo de queijo inválido: ${recipeId}`,
      code: "INVALID_CHEESE_TYPE"
    };
  }
  if (!cheeseType.available) {
    return {
      success: false,
      error: `O queijo ${cheeseType.name} ainda não está disponível.`,
      code: "CHEESE_TYPE_UNAVAILABLE"
    };
  }
  
  const inputs = recipeManager.calculateInputs(milkVolumeL);
  
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
  });

  await storage.logBatchAction({
    batchId: batch.id,
    stageId: 3,
    action: "start",
    details: { milkVolume: milkVolumeL, milkTemperatureC, milkPh, calculatedInputs: inputs }
  });

  return { success: true, batch };
}

export async function advanceBatch(batchId: number): Promise<AdvanceBatchResult> {
  const batch = await storage.getBatch(batchId);
  if (!batch) {
    return { success: false, error: "Lote não encontrado", code: "BATCH_NOT_FOUND" };
  }

  const currentStage = recipeManager.getStage(batch.currentStageId);
  if (!currentStage) {
    return { success: false, error: "Etapa inválida", code: "INVALID_STAGE" };
  }

  if (recipeManager.isLoopStage(batch.currentStageId)) {
    const measurements = (batch.measurements as Record<string, any>) || {};
    const canExitByPh = recipeManager.checkLoopExitCondition(batch.currentStageId, measurements);
    
    // Check 2-hour max duration for stage 15
    let canExitByTime = false;
    if (batch.currentStageId === 15) {
      const history = (batch.history as any[]) || [];
      const stageStartEntry = history.find((h: any) => h.stageId === 15 && h.action === 'start');
      if (stageStartEntry) {
        const stageStartTime = new Date(stageStartEntry.timestamp);
        const maxDurationMs = TEST_MODE ? 2 * 60 * 1000 : 2 * 60 * 60 * 1000; // 2 min in test, 2 hours in prod
        const elapsed = Date.now() - stageStartTime.getTime();
        canExitByTime = elapsed >= maxDurationMs;
      }
    }
    
    if (!canExitByPh && !canExitByTime) {
      const phMessage = measurements.ph_value 
        ? `pH atual: ${measurements.ph_value}` 
        : 'pH ainda não medido';
      return {
        success: false,
        error: `pH deve ser <= 5.2 para sair desta etapa (${phMessage}). Ou aguarde completar 2 horas.`,
        code: "LOOP_CONDITION_NOT_MET"
      };
    }

    // Record final state for stage 15
    if (batch.currentStageId === 15) {
      const freshBatch = await storage.getBatch(batchId);
      if (freshBatch) {
        const freshMeasurements = (freshBatch.measurements as Record<string, any>) || {};
        const turningCount = (freshBatch as any).turningCyclesCount || 0;
        const timestamp = new Date().toISOString();
        const historyEntries = [
          { key: 'turning_cycles_count', value: turningCount, stageId: 15, timestamp },
          { key: 'loop_exit_reason', value: canExitByPh ? 'ph_reached' : 'time_limit', stageId: 15, timestamp }
        ];
        const history = freshMeasurements._history || [];
        history.push(...historyEntries);
        freshMeasurements._history = history;
        await storage.updateBatch(batchId, { measurements: freshMeasurements });
      }
    }
  }

  const validation = recipeManager.validateAdvance(batch, currentStage);
  if (!validation.allowed) {
    return {
      success: false,
      error: validation.reason || "Não é possível avançar agora.",
      code: "VALIDATION_FAILED"
    };
  }

  const nextStage = recipeManager.getNextStage(batch.currentStageId);
  if (!nextStage) {
    const completed = await storage.updateBatch(batchId, { 
      status: "completed",
      completedAt: new Date()
    });
    return { success: true, batch: completed, completed: true };
  }

  let activeTimers = (batch.activeTimers as any[]) || [];
  activeTimers = activeTimers.filter(t => t.stageId !== currentStage.id);

  let activeReminders = (batch.activeReminders as any[]) || [];
  activeReminders = activeReminders.filter((r: any) => r.stageId !== currentStage.id);

  const updates: any = {
    currentStageId: nextStage.id,
    activeTimers,
    activeReminders
  };

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

  if (nextStage.id === 20) {
    const maturationEndDate = (batch as any).maturationEndDate;
    if (maturationEndDate && new Date(maturationEndDate) <= new Date()) {
      updates.batchStatus = "READY_FOR_SALE";
    }
  }

  const updatedBatch = await storage.updateBatch(batchId, updates);
  
  await storage.logBatchAction({
    batchId,
    stageId: nextStage.id,
    action: "advance",
    details: { from: currentStage.id, to: nextStage.id }
  });

  return { 
    success: true, 
    batch: updatedBatch, 
    nextStage: { id: nextStage.id, name: nextStage.name }
  };
}

export async function getActiveBatch() {
  const batches = await storage.getActiveBatches();
  return batches[0] || null;
}

export async function getBatchStatus(batchId: number) {
  const batch = await storage.getBatch(batchId);
  if (!batch) return null;
  
  const stage = recipeManager.getStage(batch.currentStageId);
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

export async function logPh(batchId: number, phValue: number, piecesQuantity?: number) {
  const batch = await storage.getBatch(batchId);
  if (!batch) return { success: false, error: "Lote não encontrado" };
  
  const measurements = (batch.measurements as any) || {};
  const inputHistory = measurements._history || [];
  const timestamp = new Date().toISOString();
  
  // Stage 13: Store as initial_ph (per recipe.yml stored_values)
  // Stage 15+: Store as ph_value in ph_measurements array
  if (batch.currentStageId === 13) {
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
    phHistory.push({ value: phValue, timestamp, stageId: batch.currentStageId });
    measurements.ph_measurements = phHistory;
    inputHistory.push({ key: 'ph_value', value: phValue, timestamp, stageId: batch.currentStageId });
  }
  
  measurements._history = inputHistory;
  const updates: any = { measurements };
  
  // Stage 15: Increment turning cycles count
  if (batch.currentStageId === 15) {
    const currentCount = (batch as any).turningCyclesCount || 0;
    updates.turningCyclesCount = currentCount + 1;
  }
  
  await storage.updateBatch(batchId, updates);
  
  await storage.logBatchAction({
    batchId,
    stageId: batch.currentStageId,
    action: "log_ph",
    details: { 
      ph_value: phValue,
      ...(piecesQuantity !== undefined && { pieces_quantity: piecesQuantity })
    }
  });
  
  return { success: true, phValue, piecesQuantity };
}

export async function logTime(batchId: number, timeValue: string, timeType?: string) {
  const batch = await storage.getBatch(batchId);
  if (!batch) return { success: false, error: "Lote não encontrado" };
  
  // Map timeType to storage key - NO generic fallback
  const timeTypeMapping: Record<string, { key: string; expectedStage: number }> = {
    'flocculation': { key: 'flocculation_time', expectedStage: 6 },
    'cut': { key: 'cut_point_time', expectedStage: 7 },
    'cut_point': { key: 'cut_point_time', expectedStage: 7 },
    'press': { key: 'press_start_time', expectedStage: 14 },
    'press_start': { key: 'press_start_time', expectedStage: 14 }
  };
  
  const mapping = timeType ? timeTypeMapping[timeType] : null;
  
  if (!mapping) {
    return { 
      success: false, 
      error: "Tipo de horário inválido. Use: floculação, corte, ou prensa.",
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
  options?: { unit?: string; notes?: string }
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
  
  await storage.updateBatch(batchId, { 
    measurements,
    chamber2EntryDate: entryDate,
    maturationEndDate: maturationEndDate,
    batchStatus: "MATURING"
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

export async function pauseBatch(batchId: number, reason?: string) {
  const batch = await storage.getBatch(batchId);
  if (!batch) return { success: false, error: "Batch not found" };
  
  if (batch.status !== "active") {
    return { success: false, error: `Cannot pause batch with status: ${batch.status}` };
  }
  
  await storage.updateBatch(batchId, { 
    status: "paused", 
    pausedAt: new Date(),
    pauseReason: reason || null
  });
  
  await storage.logBatchAction({
    batchId,
    stageId: batch.currentStageId,
    action: "pause",
    details: { reason }
  });
  
  return { success: true };
}

export async function resumeBatch(batchId: number) {
  const batch = await storage.getBatch(batchId);
  if (!batch) return { success: false, error: "Batch not found" };
  
  if (batch.status !== "paused") {
    return { success: false, error: `Cannot resume batch with status: ${batch.status}` };
  }
  
  await storage.updateBatch(batchId, { 
    status: "active", 
    pausedAt: null,
    pauseReason: null
  });
  
  await storage.logBatchAction({
    batchId,
    stageId: batch.currentStageId,
    action: "resume",
    details: {}
  });
  
  return { success: true };
}
