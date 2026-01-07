import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { api } from "@shared/routes";
import { CHEESE_TYPES, getCheeseTypeName } from "@shared/schema";
import { recipeManager, getTimerDurationMinutes, getIntervalDurationMinutes, TEST_MODE } from "./recipe";
import { registerChatRoutes } from "./replit_integrations/chat";
import { registerImageRoutes } from "./replit_integrations/image";
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
      
      // Validate cheese type is available
      const cheeseType = CHEESE_TYPES[recipeId as keyof typeof CHEESE_TYPES];
      if (!cheeseType) {
        return res.status(400).json({ message: `Tipo de queijo inválido: ${recipeId}` });
      }
      if (!cheeseType.available) {
        return res.status(400).json({ message: `O queijo ${cheeseType.name} ainda não está disponível. Apenas Nete está disponível no momento.` });
      }
      
      // Calculate inputs immediately
      const inputs = recipeManager.calculateInputs(milkVolumeL);

      // Store initial measurements from Stage 1 (new YAML v1.4 fields)
      const initialMeasurements: Record<string, any> = {
        milk_volume_l: milkVolumeL,
        _history: [
          { key: 'milk_volume_l', value: milkVolumeL, timestamp: new Date().toISOString(), stageId: 1 }
        ]
      };
      
      // Temperature and pH are now required by Stage 1
      initialMeasurements.milk_temperature_c = milkTemperatureC;
      initialMeasurements._history.push({ 
        key: 'milk_temperature_c', value: milkTemperatureC, timestamp: new Date().toISOString(), stageId: 1 
      });
      
      initialMeasurements.milk_ph = milkPh;
      initialMeasurements._history.push({ 
        key: 'milk_ph', value: milkPh, timestamp: new Date().toISOString(), stageId: 1 
      });

      // Etapas 1 e 2 são concluídas automaticamente:
      // 1 - Separar leite e medir parâmetros iniciais (informado pelo usuário)
      // 2 - Calcular proporções (feito automaticamente)
      // Inicia na etapa 3 - Aquecer o leite
      const batch = await storage.createBatch({
        recipeId: recipeId,
        currentStageId: 3, // Start at stage 3 (heating milk)
        milkVolumeL: String(milkVolumeL), // DB stores as numeric string
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

      res.status(201).json(batch);
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
    
    const batch = await storage.getBatch(batchId);
    if (!batch) return res.status(404).json({ message: "Batch not found" });
    
    if (batch.status !== "active") {
      return res.status(400).json({ message: `Cannot pause batch with status: ${batch.status}` });
    }

    const updatedBatch = await storage.updateBatch(batchId, {
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

    res.json(updatedBatch);
  });

  app.post("/api/batches/:id/resume", async (req, res) => {
    const batchId = Number(req.params.id);
    
    const batch = await storage.getBatch(batchId);
    if (!batch) return res.status(404).json({ message: "Batch not found" });
    
    if (batch.status !== "paused") {
      return res.status(400).json({ message: `Cannot resume batch with status: ${batch.status}` });
    }

    const updatedBatch = await storage.updateBatch(batchId, {
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

    res.json(updatedBatch);
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
    const batch = await storage.getBatch(batchId);
    if (!batch) return res.status(404).json({ message: "Batch not found" });

    const currentStage = recipeManager.getStage(batch.currentStageId);
    if (!currentStage) return res.status(500).json({ message: "Invalid stage" });

    // Check if this is a loop stage (e.g., stage 15)
    if (recipeManager.isLoopStage(batch.currentStageId)) {
      const measurements = (batch.measurements as Record<string, any>) || {};
      const canExitLoop = recipeManager.checkLoopExitCondition(batch.currentStageId, measurements);
      
      if (!canExitLoop) {
        return res.status(400).json({
          message: "Cannot advance: loop condition not met",
          code: "LOOP_CONDITION_NOT_MET",
          details: `pH value must be <= 5.2 to exit this stage. Current pH: ${measurements.ph_value || 'not measured'}`
        });
      }

      // Stage 15: Record turning_cycles_count in _history before advancing
      // Re-fetch batch to get latest measurements and avoid race conditions
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

    // Validate transition
    const validation = recipeManager.validateAdvance(batch, currentStage);
    if (!validation.allowed) {
        return res.status(400).json({ 
            message: "Cannot advance stage", 
            code: "VALIDATION_FAILED",
            details: validation.reason 
        });
    }

    const nextStage = recipeManager.getNextStage(batch.currentStageId);
    if (!nextStage) {
        // Recipe complete
        const completed = await storage.updateBatch(batchId, { 
          status: "completed",
          completedAt: new Date()
        });
        return res.json(completed);
    }

    // Clean up expired timers from current stage
    let activeTimers = (batch.activeTimers as any[]) || [];
    activeTimers = activeTimers.filter(t => t.stageId !== currentStage.id);

    // Clean up reminders from current stage
    let activeReminders = (batch.activeReminders as any[]) || [];
    activeReminders = activeReminders.filter((r: any) => r.stageId !== currentStage.id);

    // Handle new stage side-effects (e.g. start timers)
    const updates: any = {
        currentStageId: nextStage.id,
        activeTimers,
        activeReminders
    };

    // Handle regular timers (duration-based)
    if (nextStage.timer) {
        // Use helper functions that respect TEST_MODE
        const durationMinutes = getTimerDurationMinutes(nextStage);
        const intervalMinutes = getIntervalDurationMinutes(nextStage);
        
        // For interval timers (loop stages like stage 15)
        if (intervalMinutes > 0) {
            const intervalDesc = TEST_MODE ? "1 minuto (TESTE)" : `${nextStage.timer.interval_hours} horas`;
            activeReminders.push({
                id: generateId(),
                stageId: nextStage.id,
                type: "interval",
                intervalHours: intervalMinutes / 60, // Store as hours for compatibility
                nextTrigger: new Date(Date.now() + intervalMinutes * 60000).toISOString(),
                acknowledged: false,
                description: `Verificar pH a cada ${intervalDesc}`
            });
            updates.activeReminders = activeReminders;
        }
        
        // For duration-based timers
        if (durationMinutes > 0) {
            const durationMs = durationMinutes * 60000;
            activeTimers.push({
                stageId: nextStage.id,
                startTime: new Date().toISOString(),
                endTime: new Date(Date.now() + durationMs).toISOString(),
                durationMinutes: durationMinutes,
                blocking: nextStage.timer.blocking
            });
            updates.activeTimers = activeTimers;
        }
    }

    // Handle reminders (e.g., stage 20 daily reminder)
    if (nextStage.reminder) {
        const frequency = nextStage.reminder.frequency;
        let nextTrigger: Date;
        
        if (TEST_MODE) {
            // In TEST_MODE, reminders trigger in 1 minute
            nextTrigger = new Date(Date.now() + 60000);
        } else if (frequency === 'daily') {
            // Next trigger is tomorrow at 9am
            nextTrigger = new Date();
            nextTrigger.setDate(nextTrigger.getDate() + 1);
            nextTrigger.setHours(9, 0, 0, 0);
        } else {
            // Default: 24 hours from now
            nextTrigger = new Date(Date.now() + 24 * 3600000);
        }
        
        const reminderDesc = TEST_MODE ? `Lembrete (TESTE): ${nextStage.name}` : `Lembrete diário: ${nextStage.name}`;
        activeReminders.push({
            id: generateId(),
            stageId: nextStage.id,
            type: "daily",
            nextTrigger: nextTrigger.toISOString(),
            acknowledged: false,
            description: reminderDesc
        });
        updates.activeReminders = activeReminders;
    }

    // Special handling for Stage 20 (Maturation in Chamber 2)
    // Check if maturation has already completed based on maturation_end_date
    if (nextStage.id === 20) {
        const maturationEndDate = (batch as any).maturationEndDate;
        if (maturationEndDate && new Date(maturationEndDate) <= new Date()) {
            // Maturation already complete - mark batch as ready for sale
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

    res.json(updatedBatch);
  });
  
  // --- Alexa Webhook (ASK-Compliant) ---
  // This webhook accepts ONLY:
  // - LaunchRequest: skill opening
  // - SessionEndedRequest: skill closing
  // - IntentRequest with ProcessCommandIntent: free-form voice command
  // The backend interprets the utterance and executes actions - Alexa is just a voice adapter.
  
  // Utility function to build Alexa-compliant responses
  function buildAlexaResponse(
    speechText: string, 
    shouldEndSession: boolean = false, 
    repromptText?: string
  ) {
    const response: any = {
      version: "1.0",
      response: {
        outputSpeech: {
          type: "PlainText",
          text: speechText
        },
        shouldEndSession
      }
    };
    
    // Only include reprompt when session stays open (ASK requirement)
    if (repromptText && !shouldEndSession) {
      response.response.reprompt = {
        outputSpeech: {
          type: "PlainText",
          text: repromptText
        }
      };
    }
    
    return response;
  }
  
  // Voice command interpreter - analyzes free-form text and executes actions
  // The backend is SOVEREIGN - all decisions happen here, not in Alexa
  async function interpretVoiceCommand(utterance: string): Promise<{ speech: string; shouldEndSession: boolean }> {
    const text = utterance.toLowerCase().trim();
    
    // Get active batch for context
    const batches = await storage.getActiveBatches();
    const activeBatch = batches[0];
    
    // --- COMMAND: Start batch ---
    // Patterns: "iniciar lote", "começar produção", "novo lote", "iniciar com X litros"
    if (text.includes("iniciar") || text.includes("começar") || text.includes("novo lote")) {
      // Extract volume if mentioned
      const volumeMatch = text.match(/(\d+)\s*(litros?|l\b)/i);
      const milkVolume = volumeMatch ? parseInt(volumeMatch[1], 10) : 50;
      
      const inputs = recipeManager.calculateInputs(milkVolume);
      await storage.createBatch({
        recipeId: "queijo_nete",
        currentStageId: 3,
        milkVolumeL: String(milkVolume),
        calculatedInputs: inputs,
        status: "active",
        history: [
          { stageId: 1, action: "complete", timestamp: new Date().toISOString(), auto: true },
          { stageId: 2, action: "complete", timestamp: new Date().toISOString(), auto: true },
          { stageId: 3, action: "start", timestamp: new Date().toISOString() }
        ]
      });
      
      return {
        speech: `Lote iniciado com ${milkVolume} litros de leite. Você vai precisar de: ${inputs.FERMENT_LR} mililitros de fermento LR, ${inputs.FERMENT_DX} de DX, ${inputs.FERMENT_KL} de KL, e ${inputs.RENNET} de coalho. Aqueça o leite a 32 graus para começar.`,
        shouldEndSession: false
      };
    }
    
    // --- COMMAND: Status ---
    // Patterns: "status", "como está", "qual etapa", "situação"
    if (text.includes("status") || text.includes("como está") || text.includes("qual etapa") || text.includes("situação")) {
      if (!activeBatch) {
        return { speech: "Não há lote ativo no momento. Diga 'iniciar lote' para começar.", shouldEndSession: false };
      }
      
      const stage = recipeManager.getStage(activeBatch.currentStageId);
      const timers = (activeBatch.activeTimers as any[]) || [];
      const activeTimer = timers.find(t => new Date(t.endTime) > new Date());
      
      let speech = `Etapa ${activeBatch.currentStageId}: ${stage?.name || 'em andamento'}.`;
      
      if (activeTimer) {
        const remaining = Math.ceil((new Date(activeTimer.endTime).getTime() - Date.now()) / 60000);
        speech += ` Faltam ${remaining} minutos no timer.`;
      }
      
      return { speech, shouldEndSession: false };
    }
    
    // --- COMMAND: Timer check ---
    // Patterns: "timer", "tempo", "quanto falta", "falta quanto"
    if (text.includes("timer") || text.includes("quanto falta") || text.includes("falta quanto") || text.match(/\btempo\b/)) {
      if (!activeBatch) {
        return { speech: "Não há lote ativo.", shouldEndSession: false };
      }
      
      const timers = (activeBatch.activeTimers as any[]) || [];
      const now = new Date();
      const activeTimer = timers.find(t => new Date(t.endTime) > now);
      
      if (!activeTimer) {
        return { speech: "Não há timer ativo no momento.", shouldEndSession: false };
      }
      
      const remaining = Math.ceil((new Date(activeTimer.endTime).getTime() - now.getTime()) / 60000);
      if (remaining > 60) {
        const hours = Math.floor(remaining / 60);
        const mins = remaining % 60;
        return { speech: `Faltam ${hours} horas e ${mins} minutos no timer.`, shouldEndSession: false };
      }
      return { speech: `Faltam ${remaining} minutos no timer.`, shouldEndSession: false };
    }
    
    // --- COMMAND: Advance stage ---
    // Patterns: "avançar", "próxima etapa", "próximo passo", "continuar", "pronto"
    if (text.includes("avançar") || text.includes("próxima") || text.includes("próximo") || text.includes("continuar") || text.includes("pronto")) {
      if (!activeBatch) {
        return { speech: "Não há lote ativo para avançar.", shouldEndSession: false };
      }
      
      const currentStage = recipeManager.getStage(activeBatch.currentStageId);
      if (!currentStage) {
        return { speech: "Etapa inválida.", shouldEndSession: false };
      }
      
      const validation = recipeManager.validateAdvance(activeBatch, currentStage);
      if (!validation.allowed) {
        return { speech: validation.reason || "Não é possível avançar agora.", shouldEndSession: false };
      }
      
      const nextStage = recipeManager.getNextStage(activeBatch.currentStageId);
      if (!nextStage) {
        await storage.updateBatch(activeBatch.id, { status: "completed" });
        return { speech: "Parabéns! Receita concluída com sucesso!", shouldEndSession: false };
      }
      
      await storage.updateBatch(activeBatch.id, { currentStageId: nextStage.id });
      return { speech: `Avançando para etapa ${nextStage.id}: ${nextStage.name}.`, shouldEndSession: false };
    }
    
    // --- COMMAND: Log pH ---
    // Patterns: "registra pH X", "pH X", "acidez X", "pH cinco ponto dois"
    // Helper to convert spoken numbers to digits
    const parseSpokenNumber = (spoken: string): number | null => {
      const numWords: Record<string, number> = {
        'zero': 0, 'um': 1, 'uma': 1, 'dois': 2, 'duas': 2, 'tres': 3, 'três': 3,
        'quatro': 4, 'cinco': 5, 'seis': 6, 'sete': 7, 'oito': 8, 'nove': 9,
        'dez': 10, 'onze': 11, 'doze': 12, 'treze': 13, 'catorze': 14, 'quatorze': 14,
        'quinze': 15, 'dezesseis': 16, 'dezessete': 17, 'dezoito': 18, 'dezenove': 19, 'vinte': 20
      };
      
      // Try direct number first (e.g., "5.2", "5,2", "52")
      const directMatch = spoken.match(/(\d+[.,]?\d*)/);
      if (directMatch) return parseFloat(directMatch[1].replace(",", "."));
      
      // Try spoken format: "cinco ponto dois" or "cinco vírgula dois"
      const spokenMatch = spoken.match(/(\w+)\s*(?:ponto|vírgula|virgula|e)\s*(\w+)/i);
      if (spokenMatch) {
        const intPart = numWords[spokenMatch[1].toLowerCase()];
        const decPart = numWords[spokenMatch[2].toLowerCase()];
        if (intPart !== undefined && decPart !== undefined) {
          return parseFloat(`${intPart}.${decPart}`);
        }
      }
      
      // Try single spoken number
      const singleMatch = spoken.match(/\b(\w+)\b/);
      if (singleMatch && numWords[singleMatch[1].toLowerCase()] !== undefined) {
        return numWords[singleMatch[1].toLowerCase()];
      }
      
      return null;
    };
    
    const phMatch = text.match(/(?:ph|acidez|registra\s*ph)\s*[:\s]?\s*(.+)/i);
    if (phMatch) {
      const phValue = parseSpokenNumber(phMatch[1]);
      if (phValue === null) {
        return { speech: "Não entendi o valor do pH. Diga algo como 'pH cinco ponto dois'.", shouldEndSession: false };
      }
      if (!activeBatch) {
        return { speech: "Não há lote ativo para registrar pH.", shouldEndSession: false };
      }
      
      const measurements = (activeBatch.measurements as any) || {};
      measurements.ph_value = phValue;
      const phHistory = measurements.ph_measurements || [];
      phHistory.push({ value: phValue, timestamp: new Date().toISOString() });
      measurements.ph_measurements = phHistory;
      await storage.updateBatch(activeBatch.id, { measurements });
      
      return { speech: `pH ${phValue} registrado com sucesso.`, shouldEndSession: false };
    }
    
    // --- COMMAND: Log time ---
    // Patterns: "hora da floculação X:XX", "hora do corte X:XX", "registra horário X:XX"
    const timeMatch = text.match(/(?:hora|horário|registra\s*hora)\s*(?:da\s*)?(floculação|corte|prensa)?\s*[:\s]?\s*(\d{1,2})[:\s](\d{2})/i);
    if (timeMatch) {
      if (!activeBatch) {
        return { speech: "Não há lote ativo para registrar horário.", shouldEndSession: false };
      }
      
      const timeType = timeMatch[1]?.toLowerCase();
      const timeValue = `${timeMatch[2]}:${timeMatch[3]}`;
      
      const measurements = (activeBatch.measurements as any) || {};
      const key = timeType === 'floculação' ? 'flocculation_time' :
                  timeType === 'corte' ? 'cut_point_time' :
                  timeType === 'prensa' ? 'press_start_time' : 'recorded_time';
      measurements[key] = timeValue;
      await storage.updateBatch(activeBatch.id, { measurements });
      
      const typeLabel = timeType ? ` de ${timeType}` : '';
      return { speech: `Horário${typeLabel} ${timeValue} registrado.`, shouldEndSession: false };
    }
    
    // --- COMMAND: Pause ---
    // Patterns: "pausar", "pausa", "parar"
    if (text.includes("pausar") || text.includes("pausa") || text.match(/\bparar\b/)) {
      if (!activeBatch) {
        return { speech: "Não há lote ativo para pausar.", shouldEndSession: false };
      }
      if (activeBatch.status !== "active") {
        return { speech: `O lote já está ${activeBatch.status}.`, shouldEndSession: false };
      }
      
      await storage.updateBatch(activeBatch.id, { status: "paused", pausedAt: new Date() });
      return { speech: "Lote pausado. Diga 'retomar' quando quiser continuar.", shouldEndSession: false };
    }
    
    // --- COMMAND: Resume ---
    // Patterns: "retomar", "continuar", "despausar"
    if (text.includes("retomar") || text.includes("despausar") || (text.includes("continuar") && activeBatch?.status === "paused")) {
      if (!activeBatch) {
        return { speech: "Não há lote para retomar.", shouldEndSession: false };
      }
      if (activeBatch.status !== "paused") {
        return { speech: "O lote não está pausado.", shouldEndSession: false };
      }
      
      await storage.updateBatch(activeBatch.id, { status: "active", pausedAt: null });
      return { speech: "Lote retomado. Continuando de onde paramos.", shouldEndSession: false };
    }
    
    // --- COMMAND: Instructions for current stage ---
    // Patterns: "instruções", "o que fazer", "como fazer", "repetir"
    if (text.includes("instrução") || text.includes("instruções") || text.includes("o que fazer") || text.includes("como fazer") || text.includes("repetir")) {
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
    
    // --- COMMAND: Help ---
    // Patterns: "ajuda", "help", "comandos", "o que posso"
    if (text.includes("ajuda") || text.includes("help") || text.includes("comandos") || text.includes("o que posso")) {
      return {
        speech: "Você pode dizer: status, avançar, registra pH cinco ponto dois, hora da floculação dez e trinta, pausar, retomar, ou instruções. O que deseja?",
        shouldEndSession: false
      };
    }
    
    // --- COMMAND: Goodbye ---
    // Patterns: "tchau", "adeus", "encerrar", "sair", "fechar"
    if (text.includes("tchau") || text.includes("adeus") || text.includes("encerrar") || text.includes("sair") || text.includes("fechar")) {
      return { speech: "Até logo! Bom trabalho na queijaria.", shouldEndSession: true };
    }
    
    // --- FALLBACK: Unknown command ---
    return {
      speech: "Não entendi o comando. Diga 'ajuda' para ver as opções disponíveis.",
      shouldEndSession: false
    };
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
      if (requestType === "SessionEndedRequest") {
        return res.status(200).json(buildAlexaResponse("", true));
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
          const utterance = slots.utterance?.value || "";
          
          if (!utterance.trim()) {
            return res.status(200).json(buildAlexaResponse(
              "Não ouvi o comando. Tente novamente.",
              false,
              "Diga um comando como 'status' ou 'avançar'."
            ));
          }
          
          // Backend interprets and executes the command
          const result = await interpretVoiceCommand(utterance);
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
