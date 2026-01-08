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
    const canExitLoop = recipeManager.checkLoopExitCondition(batch.currentStageId, measurements);
    
    if (!canExitLoop) {
      return {
        success: false,
        error: `pH deve ser <= 5.2 para sair desta etapa. pH atual: ${measurements.ph_value || 'não medido'}`,
        code: "LOOP_CONDITION_NOT_MET"
      };
    }

    if (batch.currentStageId === 15) {
      const freshBatch = await storage.getBatch(batchId);
      if (freshBatch) {
        const freshMeasurements = (freshBatch.measurements as Record<string, any>) || {};
        const turningCount = (freshBatch as any).turningCyclesCount || 0;
        const historyEntry = {
          key: 'turning_cycles_count',
          value: turningCount,
          stageId: batch.currentStageId,
          timestamp: new Date().toISOString()
        };
        const history = freshMeasurements._history || [];
        history.push(historyEntry);
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

export async function logPh(batchId: number, phValue: number) {
  const batch = await storage.getBatch(batchId);
  if (!batch) return { success: false, error: "Lote não encontrado" };
  
  const measurements = (batch.measurements as any) || {};
  measurements.ph_value = phValue;
  const phHistory = measurements.ph_measurements || [];
  phHistory.push({ value: phValue, timestamp: new Date().toISOString(), stageId: batch.currentStageId });
  measurements.ph_measurements = phHistory;
  
  const inputHistory = measurements._history || [];
  inputHistory.push({ key: 'ph_value', value: phValue, timestamp: new Date().toISOString(), stageId: batch.currentStageId });
  measurements._history = inputHistory;
  
  const updates: any = { measurements };
  
  if (batch.currentStageId === 15) {
    const currentCount = (batch as any).turningCyclesCount || 0;
    updates.turningCyclesCount = currentCount + 1;
  }
  
  await storage.updateBatch(batchId, updates);
  
  await storage.logBatchAction({
    batchId,
    stageId: batch.currentStageId,
    action: "log_ph",
    details: { ph_value: phValue }
  });
  
  return { success: true, phValue };
}

export async function logTime(batchId: number, timeValue: string, timeType?: string) {
  const batch = await storage.getBatch(batchId);
  if (!batch) return { success: false, error: "Lote não encontrado" };
  
  const measurements = (batch.measurements as any) || {};
  const key = timeType === 'flocculation' ? 'flocculation_time' :
              timeType === 'cut' ? 'cut_point_time' :
              timeType === 'press' ? 'press_start_time' : 'recorded_time';
  measurements[key] = timeValue;
  
  const inputHistory = measurements._history || [];
  inputHistory.push({ key, value: timeValue, timestamp: new Date().toISOString(), stageId: batch.currentStageId });
  measurements._history = inputHistory;
  
  await storage.updateBatch(batchId, { measurements });
  
  await storage.logBatchAction({
    batchId,
    stageId: batch.currentStageId,
    action: "log_time",
    details: { [key]: timeValue }
  });
  
  return { success: true, key, timeValue };
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
