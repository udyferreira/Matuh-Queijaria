import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { api } from "@shared/routes";
import { CHEESE_TYPES, getCheeseTypeName } from "@shared/schema";
import { recipeManager, getTimerDurationMinutes, getIntervalDurationMinutes, TEST_MODE } from "./recipe";
import { registerChatRoutes } from "./replit_integrations/chat";
import { registerImageRoutes } from "./replit_integrations/image";
import * as batchService from "./batchService";
import { z } from "zod";
import { randomBytes } from "crypto";

// Helper to generate unique IDs
const generateId = () => randomBytes(8).toString('hex');

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  
  // Register AI Integrations
  registerChatRoutes(app);
  registerImageRoutes(app);

  // --- Recipe Routes ---

  app.get("/api/recipes", async (req, res) => {
    const recipes = recipeManager.getAllRecipes();
    res.json(recipes);
  });

  app.get("/api/recipes/:recipeId", async (req, res) => {
    const { recipeId } = req.params;
    if (recipeId !== "QUEIJO_NETE") {
      return res.status(404).json({ message: "Recipe not found" });
    }
    const recipe = recipeManager.getRecipeDetail();
    res.json(recipe);
  });

  // --- Batch Routes ---

  app.post(api.batches.start.path, async (req, res) => {
    try {
      const { milkVolumeL, milkTemperatureC, milkPh, recipeId } = api.batches.start.input.parse(req.body);
      
      const result = await batchService.startBatch({
        milkVolumeL,
        milkTemperatureC,
        milkPh,
        recipeId
      });
      
      if (!result.success) {
        return res.status(400).json({ message: result.error, code: result.code });
      }

      res.status(201).json(result.batch);
    } catch (err) {
       if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get(api.batches.list.path, async (req, res) => {
    const batches = await storage.getActiveBatches();
    res.json(batches);
  });

  app.get("/api/batches/completed", async (req, res) => {
    const batches = await storage.getCompletedBatches();
    res.json(batches);
  });

  app.get(api.batches.get.path, async (req, res) => {
    const batch = await storage.getBatch(Number(req.params.id));
    if (!batch) return res.status(404).json({ message: "Batch not found" });
    
    // Enrich timer data with isComplete flag for consistency with /status
    const now = new Date();
    const activeTimers = ((batch.activeTimers as any[]) || []).map(t => ({
      ...t,
      isComplete: new Date(t.endTime) <= now
    }));
    
    res.json({
      ...batch,
      activeTimers
    });
  });

  app.get(api.batches.status.path, async (req, res) => {
    const batch = await storage.getBatch(Number(req.params.id));
    if (!batch) return res.status(404).json({ message: "Batch not found" });

    const stage = recipeManager.getStage(batch.currentStageId);
    const activeTimers = (batch.activeTimers as any[]) || [];
    
    // Mark timers as complete but don't remove them (removal happens on advance)
    const now = new Date();
    const timersWithStatus = activeTimers.map(t => ({
      ...t,
      isComplete: new Date(t.endTime) <= now
    }));

    // Include active reminders in status for consistency
    const activeReminders = (batch.activeReminders as any[]) || [];

    res.json({
        batchId: batch.id,
        currentStageId: batch.currentStageId,
        status: batch.status,
        activeTimers: timersWithStatus,
        activeReminders: activeReminders,
        nextAction: stage?.instructions?.[0] || stage?.name || "Proceed",
        guidance: stage?.llm_guidance
    });
  });

  // Get current stage details
  app.get("/api/batches/:id/stage", async (req, res) => {
    const batch = await storage.getBatch(Number(req.params.id));
    if (!batch) return res.status(404).json({ message: "Batch not found" });

    const stage = recipeManager.getStage(batch.currentStageId);
    if (!stage) return res.status(500).json({ message: "Invalid stage" });

    res.json(recipeManager.formatStageDetail(stage));
  });

  // --- Operational State Endpoints ---

  app.post("/api/batches/:id/pause", async (req, res) => {
    const batchId = Number(req.params.id);
    const { reason } = req.body || {};
    
    const result = await batchService.pauseBatch(batchId, reason);
    
    if (!result.success) {
      const statusCode = result.error?.includes("not found") ? 404 : 400;
      return res.status(statusCode).json({ message: result.error });
    }

    const batch = await storage.getBatch(batchId);
    res.json(batch);
  });

  app.post("/api/batches/:id/resume", async (req, res) => {
    const batchId = Number(req.params.id);
    
    const result = await batchService.resumeBatch(batchId);
    
    if (!result.success) {
      const statusCode = result.error?.includes("not found") ? 404 : 400;
      return res.status(statusCode).json({ message: result.error });
    }

    const batch = await storage.getBatch(batchId);
    res.json(batch);
  });

  app.post("/api/batches/:id/complete", async (req, res) => {
    const batchId = Number(req.params.id);
    
    const batch = await storage.getBatch(batchId);
    if (!batch) return res.status(404).json({ message: "Batch not found" });
    
    if (batch.status === "completed" || batch.status === "cancelled") {
      return res.status(400).json({ message: `Batch already ${batch.status}` });
    }

    const updatedBatch = await storage.updateBatch(batchId, {
      status: "completed",
      completedAt: new Date()
    });

    await storage.logBatchAction({
      batchId,
      stageId: batch.currentStageId,
      action: "complete",
      details: { completedAt: new Date().toISOString() }
    });

    res.json(updatedBatch);
  });

  app.post("/api/batches/:id/cancel", async (req, res) => {
    const batchId = Number(req.params.id);
    const { reason } = req.body || {};
    
    if (!reason) {
      return res.status(400).json({ message: "Reason is required to cancel a batch" });
    }

    const batch = await storage.getBatch(batchId);
    if (!batch) return res.status(404).json({ message: "Batch not found" });
    
    if (batch.status === "completed" || batch.status === "cancelled") {
      return res.status(400).json({ message: `Cannot cancel batch with status: ${batch.status}` });
    }

    const updatedBatch = await storage.updateBatch(batchId, {
      status: "cancelled",
      cancelledAt: new Date(),
      cancelReason: reason
    });

    await storage.logBatchAction({
      batchId,
      stageId: batch.currentStageId,
      action: "cancel",
      details: { reason }
    });

    res.json(updatedBatch);
  });

  // --- Timer and Reminder Endpoints ---

  app.get("/api/batches/:id/timers", async (req, res) => {
    const batch = await storage.getBatch(Number(req.params.id));
    if (!batch) return res.status(404).json({ message: "Batch not found" });

    const now = new Date();
    const activeTimers = ((batch.activeTimers as any[]) || []).map(t => {
      const endTime = new Date(t.endTime);
      const remainingMs = Math.max(0, endTime.getTime() - now.getTime());
      return {
        ...t,
        isComplete: endTime <= now,
        remainingSeconds: Math.ceil(remainingMs / 1000)
      };
    });

    res.json(activeTimers);
  });

  app.get("/api/batches/:id/reminders", async (req, res) => {
    const batch = await storage.getBatch(Number(req.params.id));
    if (!batch) return res.status(404).json({ message: "Batch not found" });

    const activeReminders = (batch.activeReminders as any[]) || [];
    res.json(activeReminders);
  });

  app.post("/api/batches/:id/reminders/:reminderId/ack", async (req, res) => {
    const batchId = Number(req.params.id);
    const { reminderId } = req.params;
    
    const batch = await storage.getBatch(batchId);
    if (!batch) return res.status(404).json({ message: "Batch not found" });

    const activeReminders = (batch.activeReminders as any[]) || [];
    const reminderIndex = activeReminders.findIndex((r: any) => r.id === reminderId);
    
    if (reminderIndex === -1) {
      return res.status(404).json({ message: "Reminder not found" });
    }

    // Mark as acknowledged and calculate next trigger
    const reminder = activeReminders[reminderIndex];
    reminder.acknowledged = true;
    reminder.lastAcknowledged = new Date().toISOString();
    
    // For interval reminders, calculate next trigger
    if (reminder.intervalHours) {
      reminder.nextTrigger = new Date(Date.now() + reminder.intervalHours * 3600000).toISOString();
      reminder.acknowledged = false; // Reset for next cycle
    }

    activeReminders[reminderIndex] = reminder;
    
    await storage.updateBatch(batchId, { activeReminders });
    
    await storage.logBatchAction({
      batchId,
      stageId: batch.currentStageId,
      action: "reminder_ack",
      details: { reminderId, reminderType: reminder.type }
    });

    res.json(reminder);
  });

  // Legacy input endpoint (maintains backwards compatibility)
  app.post(api.batches.input.path, async (req, res) => {
    const batchId = Number(req.params.id);
    const { type, value, notes } = api.batches.input.input.parse(req.body);
    
    const batch = await storage.getBatch(batchId);
    if (!batch) return res.status(404).json({ message: "Batch not found" });

    const measurements = (batch.measurements as any) || {};
    const timestamp = new Date().toISOString();

    // Store based on type
    if (type === 'ph') {
        const phs = measurements.ph || [];
        phs.push({ value, timestamp, notes, stageId: batch.currentStageId });
        measurements.ph = phs;
        // Also update latest ph_value for quick access
        measurements.ph_value = value;
        
        // Also sync to _history and ph_measurements for consistency
        const inputHistory = measurements._history || [];
        inputHistory.push({ key: 'ph_value', value, timestamp, stageId: batch.currentStageId });
        measurements._history = inputHistory;
        
        const phMeasurements = measurements.ph_measurements || [];
        phMeasurements.push({ value, timestamp, stageId: batch.currentStageId });
        measurements.ph_measurements = phMeasurements;
    } else if (type === 'time') {
        // e.g. flocculation time
        // We need to know WHICH time it is. 
        // For MVP, we'll map the current stage to the expected input
        const stage = recipeManager.getStage(batch.currentStageId);
        if (stage?.stored_values?.includes('flocculation_time')) {
            measurements.flocculation_time = value; // assuming value is string/time
        } else if (stage?.stored_values?.includes('cut_point_time')) {
            measurements.cut_point_time = value;
        } else if (stage?.stored_values?.includes('press_start_time')) {
            measurements.press_start_time = value;
        }
    }

    await storage.updateBatch(batchId, { measurements });
    
    await storage.logBatchAction({
        batchId,
        stageId: batch.currentStageId,
        action: "input",
        details: { type, value, notes }
    });

    res.json(await storage.getBatch(batchId));
  });

  // New canonical input endpoint (aligned with YAML schema)
  app.post("/api/batches/:id/input/canonical", async (req, res) => {
    const batchId = Number(req.params.id);
    const { key, value, unit, notes } = req.body;
    
    if (!key || value === undefined) {
      return res.status(400).json({ 
        message: "Key and value are required",
        code: "VALIDATION_FAILED",
        details: "Both 'key' and 'value' fields are required"
      });
    }

    const batch = await storage.getBatch(batchId);
    if (!batch) {
      return res.status(404).json({ 
        message: "Batch not found",
        code: "BATCH_NOT_FOUND",
        details: `No batch exists with id=${batchId}`
      });
    }

    // Check if batch is active
    if (batch.status !== "active") {
      return res.status(400).json({
        message: "Batch is not active",
        code: "BATCH_NOT_ACTIVE",
        details: `Batch status is '${batch.status}'. Only active batches can receive inputs.`
      });
    }

    // Check if batch is closed (maturation complete)
    if ((batch as any).batchStatus === "CLOSED") {
      return res.status(400).json({
        message: "Batch is closed",
        code: "BATCH_CLOSED",
        details: "This batch has completed maturation and cannot receive new inputs."
      });
    }

    // Validate that the key is expected for current stage
    const expectedInputs = recipeManager.getExpectedInputsForStage(batch.currentStageId);
    if (expectedInputs.length > 0 && !expectedInputs.includes(key)) {
      return res.status(400).json({ 
        message: "Key não esperado para esta etapa",
        code: "INVALID_INPUT_KEY_FOR_STAGE",
        stage: batch.currentStageId,
        allowed_fields: expectedInputs,
        details: `stageId=${batch.currentStageId}, allowedKeys=[${expectedInputs.join(', ')}], receivedKey=${key}`
      });
    }

    const measurements = (batch.measurements as any) || {};
    const timestamp = new Date().toISOString();
    const updates: any = {};

    // Store the canonical value
    measurements[key] = value;
    
    // Also store in history array for tracking
    const inputHistory = measurements._history || [];
    inputHistory.push({ key, value, unit, notes, timestamp, stageId: batch.currentStageId });
    measurements._history = inputHistory;

    // Special handling for pH measurements array (Stage 15 loop)
    if (key === 'ph_value') {
      const phMeasurements = measurements.ph_measurements || [];
      phMeasurements.push({ value, timestamp, stageId: batch.currentStageId });
      measurements.ph_measurements = phMeasurements;
      
      // Stage 15: Increment turning cycles count
      if (batch.currentStageId === 15) {
        const currentCount = (batch as any).turningCyclesCount || 0;
        updates.turningCyclesCount = currentCount + 1;
      }
    }

    // Store pieces_quantity (Stage 13)
    if (key === 'pieces_quantity') {
      measurements.pieces_quantity = value;
    }

    // Store initial_ph (Stage 13)
    if (key === 'ph_value' && batch.currentStageId === 13) {
      measurements.initial_ph = value;
    }

    // Handle chamber_2_entry_date (Stage 19) - triggers maturation
    if (key === 'chamber_2_entry_date') {
      const entryDate = new Date(value);
      const maturationEndDate = new Date(entryDate);
      maturationEndDate.setDate(maturationEndDate.getDate() + 90); // 90 days maturation
      
      updates.chamber2EntryDate = entryDate;
      updates.maturationEndDate = maturationEndDate;
      updates.batchStatus = "MATURING";
    }

    updates.measurements = measurements;
    await storage.updateBatch(batchId, updates);
    
    await storage.logBatchAction({
      batchId,
      stageId: batch.currentStageId,
      action: "canonical_input",
      details: { key, value, unit, notes }
    });

    // Return updated batch with additional loop info for Stage 15
    const updatedBatch = await storage.getBatch(batchId);
    const response: any = { ...updatedBatch };
    
    if (batch.currentStageId === 15) {
      response.turning_cycles_count = (updatedBatch as any).turningCyclesCount || 0;
      response.ph_measurements = (updatedBatch?.measurements as any)?.ph_measurements || [];
      response.next_action = value <= 5.2 
        ? "pH atingiu 5.2. Pode avançar para próxima etapa."
        : "Medir pH novamente ou aguardar até 2 horas";
    }

    res.json(response);
  });

  app.post(api.batches.advance.path, async (req, res) => {
    const batchId = Number(req.params.id);
    
    const result = await batchService.advanceBatch(batchId);
    
    if (!result.success) {
      const statusCode = result.code === "BATCH_NOT_FOUND" ? 404 : 400;
      return res.status(statusCode).json({ 
        message: result.error, 
        code: result.code 
      });
    }

    res.json(result.batch);
  });
  
  // --- Alexa Webhook (ASK-Compliant) ---
  // This webhook accepts ONLY:
  // - LaunchRequest: skill opening
  // - SessionEndedRequest: skill closing
  // - IntentRequest with ProcessCommandIntent: free-form voice command
  // The backend interprets the utterance and executes actions - Alexa is just a voice adapter.
  
  // Utility function to build Alexa-compliant responses
  // CRITICAL: NEVER returns empty outputSpeech.text - always has fallback
  const DEFAULT_FALLBACK_SPEECH = "Tudo bem. Até logo.";
  const DEFAULT_SESSION_OPEN_FALLBACK = "Não entendi o comando. Pode repetir?";
  const DEFAULT_REPROMPT = "O que mais posso ajudar?";
  
  function buildAlexaResponse(
    speechText: string, 
    shouldEndSession: boolean = false, 
    repromptText?: string
  ) {
    // NEVER allow empty speech text - always use a fallback
    let finalSpeech = speechText?.trim();
    if (!finalSpeech) {
      finalSpeech = shouldEndSession ? DEFAULT_FALLBACK_SPEECH : DEFAULT_SESSION_OPEN_FALLBACK;
    }
    
    const response: any = {
      version: "1.0",
      response: {
        outputSpeech: {
          type: "PlainText",
          text: finalSpeech
        },
        shouldEndSession
      }
    };
    
    // Only include reprompt when session stays open (ASK requirement)
    if (!shouldEndSession) {
      const finalReprompt = repromptText?.trim() || DEFAULT_REPROMPT;
      response.response.reprompt = {
        outputSpeech: {
          type: "PlainText",
          text: finalReprompt
        }
      };
    }
    
    return response;
  }
  
  // Import LLM-based command interpreter
  const { interpretCommand } = await import("./interpreter.js");
  
  // Execute action based on interpreted intent - backend is SOVEREIGN
  // LLM only interprets, backend decides and executes
  // IMPORTANT: Uses batchService for ALL operations to ensure consistency with REST API
  async function executeIntent(
    command: Awaited<ReturnType<typeof interpretCommand>>
  ): Promise<{ speech: string; shouldEndSession: boolean }> {
    
    // Get active batch for context
    const activeBatch = await batchService.getActiveBatch();
    
    switch (command.intent) {
      case "start_batch": {
        // FIXED: Now requires volume + temperature + pH (same as web)
        const milkVolume = command.entities.volume;
        const milkTemperature = command.entities.milk_temperature;
        const milkPh = command.entities.ph_value;
        
        // Check for missing fields and ask for them
        const missing: string[] = [];
        if (milkVolume === undefined || milkVolume === null) missing.push("volume de leite");
        if (milkTemperature === undefined || milkTemperature === null) missing.push("temperatura do leite");
        if (milkPh === undefined || milkPh === null) missing.push("pH do leite");
        
        if (missing.length > 0) {
          return {
            speech: `Para iniciar o lote, preciso saber: ${missing.join(", ")}. Por exemplo: "iniciar lote com 80 litros, temperatura 32 graus, pH 6.5".`,
            shouldEndSession: false
          };
        }
        
        const result = await batchService.startBatch({
          milkVolumeL: milkVolume!,
          milkTemperatureC: milkTemperature!,
          milkPh: milkPh!,
          recipeId: "QUEIJO_NETE"
        });
        
        if (!result.success) {
          return { speech: result.error || "Erro ao iniciar lote.", shouldEndSession: false };
        }
        
        const inputs = result.batch.calculatedInputs;
        return {
          speech: `Lote iniciado com ${milkVolume} litros de leite a ${milkTemperature} graus e pH ${milkPh}. Você vai precisar de: ${inputs.FERMENT_LR} mililitros de fermento LR, ${inputs.FERMENT_DX} de DX, ${inputs.FERMENT_KL} de KL, e ${inputs.RENNET} de coalho. Aqueça o leite a 32 graus para começar.`,
          shouldEndSession: false
        };
      }
      
      case "status": {
        if (!activeBatch) {
          return { speech: "Não há lote ativo no momento. Diga 'iniciar lote' para começar.", shouldEndSession: false };
        }
        const status = await batchService.getBatchStatus(activeBatch.id);
        if (!status) {
          return { speech: "Erro ao obter status.", shouldEndSession: false };
        }
        let speech = `Etapa ${status.currentStageId}: ${status.stageName || 'em andamento'}.`;
        const activeTimer = status.activeTimers.find(t => !t.isComplete);
        if (activeTimer) {
          const remaining = Math.ceil(activeTimer.remainingSeconds / 60);
          speech += ` Faltam ${remaining} minutos no timer.`;
        }
        return { speech, shouldEndSession: false };
      }
      
      case "advance": {
        if (!activeBatch) {
          return { speech: "Não há lote ativo para avançar.", shouldEndSession: false };
        }
        
        // FIXED: Now uses batchService which creates timers correctly
        const result = await batchService.advanceBatch(activeBatch.id);
        
        if (!result.success) {
          return { speech: result.error || "Não é possível avançar agora.", shouldEndSession: false };
        }
        
        if (result.completed) {
          return { speech: "Parabéns! Receita concluída com sucesso!", shouldEndSession: false };
        }
        
        return { 
          speech: `Avançando para etapa ${result.nextStage?.id}: ${result.nextStage?.name}.`, 
          shouldEndSession: false 
        };
      }
      
      case "log_time": {
        if (!activeBatch) {
          return { speech: "Não há lote ativo para registrar horário.", shouldEndSession: false };
        }
        const timeValue = command.entities.time_value;
        const timeType = command.entities.time_type;
        if (!timeValue) {
          return { speech: "Não entendi o horário. Diga algo como 'hora da floculação dez e trinta'.", shouldEndSession: false };
        }
        
        const result = await batchService.logTime(activeBatch.id, timeValue, timeType || undefined);
        if (!result.success) {
          return { speech: result.error || "Erro ao registrar horário.", shouldEndSession: false };
        }
        const typeLabel = timeType === 'flocculation' ? ' de floculação' :
                          timeType === 'cut_point' ? ' do ponto de corte' :
                          timeType === 'press_start' ? ' de início de prensa' : '';
        return { speech: `Horário${typeLabel} ${timeValue} registrado.`, shouldEndSession: false };
      }
      
      case "log_date": {
        if (!activeBatch) {
          return { speech: "Não há lote ativo para registrar data.", shouldEndSession: false };
        }
        const dateValue = command.entities.date_value;
        const dateType = command.entities.date_type;
        if (!dateValue) {
          return { speech: "Não entendi a data. Diga algo como 'entrada na câmara dois hoje'.", shouldEndSession: false };
        }
        
        if (dateType === "chamber_2_entry") {
          const measurements = (activeBatch.measurements as Record<string, any>) || {};
          measurements["chamber_2_entry_date"] = dateValue;
          await storage.updateBatch(activeBatch.id, { 
            measurements,
            chamber2EntryDate: new Date(dateValue)
          });
          return { speech: `Data de entrada na câmara dois ${dateValue} registrada.`, shouldEndSession: false };
        }
        
        return { speech: "Tipo de data não reconhecido.", shouldEndSession: false };
      }
      
      case "log_number": {
        if (!activeBatch) {
          return { speech: "Não há lote ativo para registrar valor.", shouldEndSession: false };
        }
        const numberValue = command.entities.number_value;
        const numberType = command.entities.number_type;
        if (numberValue === undefined || numberValue === null) {
          return { speech: "Não entendi o valor. Diga algo como 'o pH é cinco ponto dois' ou 'tem doze peças'.", shouldEndSession: false };
        }
        
        if (numberType === "ph_value") {
          const result = await batchService.logPh(activeBatch.id, numberValue);
          if (!result.success) {
            return { speech: result.error || "Erro ao registrar pH.", shouldEndSession: false };
          }
          return { speech: `pH ${numberValue} registrado com sucesso.`, shouldEndSession: false };
        }
        
        if (numberType === "pieces_quantity") {
          const measurements = (activeBatch.measurements as Record<string, any>) || {};
          measurements["pieces_quantity"] = numberValue;
          await storage.updateBatch(activeBatch.id, { measurements });
          return { speech: `Quantidade de ${numberValue} peças registrada.`, shouldEndSession: false };
        }
        
        if (numberType === "milk_temperature") {
          const measurements = (activeBatch.measurements as Record<string, any>) || {};
          measurements["current_temperature"] = numberValue;
          await storage.updateBatch(activeBatch.id, { measurements });
          return { speech: `Temperatura ${numberValue} graus registrada.`, shouldEndSession: false };
        }
        
        return { speech: "Tipo de valor não reconhecido.", shouldEndSession: false };
      }
      
      case "pause": {
        if (!activeBatch) {
          return { speech: "Não há lote ativo para pausar.", shouldEndSession: false };
        }
        
        // FIXED: Now uses batchService for consistent state management
        const result = await batchService.pauseBatch(activeBatch.id);
        if (!result.success) {
          return { speech: result.error || "Erro ao pausar lote.", shouldEndSession: false };
        }
        return { speech: "Lote pausado. Diga 'retomar' quando quiser continuar.", shouldEndSession: false };
      }
      
      case "resume": {
        if (!activeBatch) {
          return { speech: "Não há lote para retomar.", shouldEndSession: false };
        }
        
        // FIXED: Now uses batchService for consistent state management
        const result = await batchService.resumeBatch(activeBatch.id);
        if (!result.success) {
          return { speech: result.error || "Erro ao retomar lote.", shouldEndSession: false };
        }
        return { speech: "Lote retomado. Continuando de onde paramos.", shouldEndSession: false };
      }
      
      case "instructions": {
        if (!activeBatch) {
          return { speech: "Não há lote ativo.", shouldEndSession: false };
        }
        const stage = recipeManager.getStage(activeBatch.currentStageId);
        if (stage?.instructions && stage.instructions.length > 0) {
          let speech = stage.instructions.join('. ');
          if (stage.llm_guidance) {
            speech += ` Dica: ${stage.llm_guidance}`;
          }
          return { speech, shouldEndSession: false };
        }
        return { speech: stage?.name || "Prossiga com a produção.", shouldEndSession: false };
      }
      
      case "timer": {
        if (!activeBatch) {
          return { speech: "Não há lote ativo.", shouldEndSession: false };
        }
        
        // FIXED: Now reads timers from batchService which are created by advance
        const status = await batchService.getBatchStatus(activeBatch.id);
        if (!status) {
          return { speech: "Erro ao obter status.", shouldEndSession: false };
        }
        
        const activeTimer = status.activeTimers.find(t => !t.isComplete);
        if (!activeTimer) {
          return { speech: "Não há timer ativo no momento.", shouldEndSession: false };
        }
        
        const remaining = Math.ceil(activeTimer.remainingSeconds / 60);
        if (remaining > 60) {
          const hours = Math.floor(remaining / 60);
          const mins = remaining % 60;
          return { speech: `Faltam ${hours} horas e ${mins} minutos no timer.`, shouldEndSession: false };
        }
        return { speech: `Faltam ${remaining} minutos no timer.`, shouldEndSession: false };
      }
      
      case "query_input": {
        if (!activeBatch) {
          return { speech: "Não há lote ativo para consultar insumos.", shouldEndSession: false };
        }
        
        const inputType = command.entities.input_type;
        if (!inputType) {
          return { speech: "Qual insumo você quer consultar? LR, DX, KL ou coalho?", shouldEndSession: false };
        }
        
        const calculatedInputs = activeBatch.calculatedInputs as Record<string, number> | null;
        if (!calculatedInputs) {
          return { speech: "Os insumos ainda não foram calculados para este lote.", shouldEndSession: false };
        }
        
        const inputNames: Record<string, string> = {
          "FERMENT_LR": "fermento LR",
          "FERMENT_DX": "fermento DX",
          "FERMENT_KL": "fermento KL",
          "RENNET": "coalho"
        };
        
        const value = calculatedInputs[inputType];
        if (value === undefined) {
          return { speech: `O insumo ${inputNames[inputType] || inputType} não foi encontrado.`, shouldEndSession: false };
        }
        
        const unit = inputType === "RENNET" ? "ml" : "gramas";
        return { 
          speech: `A quantidade de ${inputNames[inputType]} é ${value} ${unit}.`, 
          shouldEndSession: false 
        };
      }
      
      case "help": {
        return {
          speech: "Você pode dizer: status, avançar, registra pH cinco ponto dois, hora da floculação dez e trinta, pausar, retomar, ou instruções. Para iniciar um lote, diga: iniciar lote com 80 litros, temperatura 32 graus, pH 6.5.",
          shouldEndSession: false
        };
      }
      
      case "goodbye": {
        return { speech: "Até logo! Bom trabalho na queijaria.", shouldEndSession: true };
      }
      
      case "unknown":
      default: {
        return {
          speech: "Não entendi o comando. Diga 'ajuda' para ver as opções disponíveis.",
          shouldEndSession: false
        };
      }
    }
  }

  app.post("/api/alexa/webhook", async (req, res) => {
    // Always return HTTP 200 - errors are communicated via speech
    try {
      const alexaRequest = req.body;
      const requestType = alexaRequest?.request?.type;
      
      // --- LaunchRequest: Skill opening ---
      if (requestType === "LaunchRequest") {
        return res.status(200).json(buildAlexaResponse(
          "Bem-vindo à Matuh Queijaria! Diga um comando como 'status' ou 'iniciar lote com 50 litros'.",
          false,
          "Diga 'ajuda' para ver os comandos."
        ));
      }
      
      // --- SessionEndedRequest: Skill closing ---
      // Session already ended by Alexa - return minimal response without speech
      // This happens when: user is silent, timeout, error, or external close
      if (requestType === "SessionEndedRequest") {
        return res.status(200).json({
          version: "1.0",
          response: {}
        });
      }
      
      // --- IntentRequest: Process voice command ---
      if (requestType === "IntentRequest") {
        const intent = alexaRequest?.request?.intent;
        const intentName = intent?.name;
        const slots = intent?.slots || {};
        
        // Handle Amazon built-in intents
        if (intentName === "AMAZON.CancelIntent" || intentName === "AMAZON.StopIntent") {
          return res.status(200).json(buildAlexaResponse("Até logo! Bom trabalho na queijaria.", true));
        }
        
        if (intentName === "AMAZON.HelpIntent") {
          return res.status(200).json(buildAlexaResponse(
            "Você pode dizer: status, avançar, registra pH, hora da floculação, pausar, retomar, ou instruções. O que deseja?",
            false,
            "Diga um comando."
          ));
        }
        
        if (intentName === "AMAZON.FallbackIntent") {
          return res.status(200).json(buildAlexaResponse(
            "Não entendi. Diga 'ajuda' para ver os comandos.",
            false,
            "Diga 'ajuda' para ver os comandos."
          ));
        }
        
        // --- ProcessCommandIntent: Main voice command processing ---
        // This is the ONLY custom intent - all voice commands come through here
        if (intentName === "ProcessCommandIntent") {
          // Log the full slots structure for debugging
          console.log("Alexa slots received:", JSON.stringify(slots, null, 2));
          
          // Extract utterance from multiple possible slot formats
          // Alexa can send the value in different ways depending on slot type
          let utterance = "";
          const utteranceSlot = slots.utterance || slots.command || slots.query || Object.values(slots)[0];
          
          if (utteranceSlot) {
            // Try direct value first
            if (typeof utteranceSlot.value === "string") {
              utterance = utteranceSlot.value;
            }
            // Try slotValue.value (for some slot types)
            else if (utteranceSlot.slotValue?.value) {
              utterance = utteranceSlot.slotValue.value;
            }
            // Try resolutions (for slots with entity resolution)
            else if (utteranceSlot.resolutions?.resolutionsPerAuthority?.[0]?.values?.[0]?.value?.name) {
              utterance = utteranceSlot.resolutions.resolutionsPerAuthority[0].values[0].value.name;
            }
          }
          
          console.log("Extracted utterance:", utterance);
          
          // GUARDA-CORPO: Se slot vazio, pedir clarificação amigável
          // Samples sem slot (ex: "status" sozinho) invocam o intent mas slot fica vazio
          // A Alexa não informa qual sample foi usado, então precisamos pedir mais contexto
          let textToInterpret = utterance.trim();
          if (!textToInterpret) {
            console.log("Slot vazio - pedindo clarificação");
            return res.status(200).json(buildAlexaResponse(
              "Entendi! Pode dar mais detalhes? Por exemplo: 'qual o status', 'quero avançar', ou 'preciso de ajuda'.",
              false,
              "Diga um comando completo como 'qual o status' ou 'quero avançar'."
            ));
          }
          
          // LLM interprets the command, backend executes
          const command = await interpretCommand(textToInterpret);
          console.log("LLM interpreted command:", JSON.stringify(command));
          const result = await executeIntent(command);
          return res.status(200).json(buildAlexaResponse(
            result.speech,
            result.shouldEndSession,
            result.shouldEndSession ? undefined : "O que mais posso ajudar?"
          ));
        }
        
        // Unknown intent - treat as fallback
        return res.status(200).json(buildAlexaResponse(
          "Comando não reconhecido. Diga 'ajuda' para ver as opções.",
          false,
          "Diga 'ajuda' para ver os comandos."
        ));
      }
      
      // Fallback for unknown request types
      return res.status(200).json(buildAlexaResponse(
        "Desculpe, não consegui processar sua solicitação.",
        false,
        "Diga 'ajuda' para ver os comandos."
      ));
      
    } catch (error) {
      console.error("Alexa webhook error:", error);
      // Always return 200 with error message via speech
      return res.status(200).json(buildAlexaResponse(
        "Ocorreu um erro. Tente novamente.",
        false,
        "Diga 'ajuda' para ver os comandos."
      ));
    }
  });
  
  // Basic Seed
  const existingBatches = await storage.getActiveBatches();
  if (existingBatches.length === 0) {
      console.log("Seeding initial batch...");
      // Add a test batch
  }

  return httpServer;
}
