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

  app.get("/api/batches/active", async (req, res) => {
    const batch = await batchService.getActiveBatch();
    if (!batch) return res.status(404).json({ message: "Nenhum lote ativo" });
    res.json(batch);
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
  
  // Build Alexa Dialog.ElicitSlot response for slot elicitation
  function buildAlexaElicitSlotResponse(
    slotToElicit: string,
    intentName: string,
    speechText: string,
    repromptText?: string,
    currentSlots?: Record<string, any>
  ) {
    const response: any = {
      version: "1.0",
      response: {
        outputSpeech: {
          type: "PlainText",
          text: speechText
        },
        shouldEndSession: false,
        directives: [
          {
            type: "Dialog.ElicitSlot",
            slotToElicit: slotToElicit,
            updatedIntent: {
              name: intentName,
              confirmationStatus: "NONE",
              slots: {}
            }
          }
        ],
        reprompt: {
          outputSpeech: {
            type: "PlainText",
            text: repromptText || speechText
          }
        }
      }
    };
    
    // Copy existing slot values to preserve state
    if (currentSlots) {
      for (const [key, value] of Object.entries(currentSlots)) {
        response.response.directives[0].updatedIntent.slots[key] = {
          name: key,
          value: value?.value,
          confirmationStatus: "NONE"
        };
      }
    }
    
    return response;
  }
  
  // Normalize pH value: 54 -> 5.4, 62 -> 6.2, etc.
  function normalizePHValue(rawValue: string | number): number | null {
    let num = typeof rawValue === 'string' ? parseFloat(rawValue) : rawValue;
    if (isNaN(num)) return null;
    
    // If it's an integer between 40 and 80, divide by 10
    // This handles cases like "54" spoken as "cinquenta e quatro" for pH 5.4
    if (Number.isInteger(num) && num >= 40 && num <= 80) {
      num = num / 10;
    }
    
    // Validate pH range (4.0 to 7.5 is typical for cheese making)
    if (num < 4.0 || num > 7.5) {
      return null;
    }
    
    return Math.round(num * 10) / 10; // Round to 1 decimal place
  }
  
  // Import LLM-based command interpreter
  const { interpretCommand } = await import("./interpreter.js");
  
  // --- Conversational State for Pending Inputs ---
  // Simple in-memory state keyed by Alexa session ID
  interface PendingInput {
    type: "time" | "date" | "number";
    subType?: string; // flocculation, cut_point, press_start, etc.
    createdAt: number;
  }
  const pendingInputs = new Map<string, PendingInput>();
  
  // Clean up old pending inputs (older than 5 minutes)
  function cleanupPendingInputs() {
    const now = Date.now();
    const entries = Array.from(pendingInputs.entries());
    for (const [sessionId, pending] of entries) {
      if (now - pending.createdAt > 5 * 60 * 1000) {
        pendingInputs.delete(sessionId);
      }
    }
  }
  
  // --- Deterministic Time Parsing ---
  // Parses spoken time formats to HH:MM
  const TIME_WORDS: Record<string, number> = {
    "zero": 0, "uma": 1, "um": 1, "duas": 2, "dois": 2, "três": 3, "tres": 3,
    "quatro": 4, "cinco": 5, "seis": 6, "sete": 7, "oito": 8, "nove": 9,
    "dez": 10, "onze": 11, "doze": 12, "treze": 13, "catorze": 14, "quatorze": 14,
    "quinze": 15, "dezesseis": 16, "dezessete": 17, "dezoito": 18, "dezenove": 19,
    "vinte": 20, "trinta": 30, "quarenta": 40, "cinquenta": 50,
    "meia": 30
  };
  
  function parseSpokenTime(text: string): string | null {
    const normalized = text.toLowerCase().trim();
    
    // Handle "agora" - current time in Brasília timezone (America/Sao_Paulo)
    if (normalized === "agora") {
      const now = new Date();
      const brasiliaTime = now.toLocaleString('pt-BR', { 
        timeZone: 'America/Sao_Paulo',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      });
      return brasiliaTime;
    }
    
    // Handle "15:30" or "15 30" format
    const numericMatch = normalized.match(/^(\d{1,2})[:\s](\d{2})$/);
    if (numericMatch) {
      const hours = parseInt(numericMatch[1], 10);
      const minutes = parseInt(numericMatch[2], 10);
      if (hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59) {
        return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
      }
    }
    
    // Handle just "15" or "quinze" (assume :00)
    const singleHourNum = normalized.match(/^(\d{1,2})$/);
    if (singleHourNum) {
      const hours = parseInt(singleHourNum[1], 10);
      if (hours >= 0 && hours <= 23) {
        return `${String(hours).padStart(2, '0')}:00`;
      }
    }
    
    // Handle spoken format "quinze trinta", "quinze e trinta", "quinze e meia"
    const words = normalized.replace(/\s+e\s+/g, ' ').split(/\s+/);
    let hours = -1;
    let minutes = 0;
    
    for (let i = 0; i < words.length; i++) {
      const word = words[i];
      const value = TIME_WORDS[word];
      
      if (value !== undefined) {
        if (hours === -1) {
          // First number is hours
          hours = value;
          // Check for compound like "vinte e uma"
          if (i + 1 < words.length && TIME_WORDS[words[i + 1]] !== undefined && TIME_WORDS[words[i + 1]] < 10) {
            hours += TIME_WORDS[words[i + 1]];
            i++;
          }
        } else {
          // Second number is minutes
          minutes = value;
          // Check for compound like "trinta e cinco"
          if (i + 1 < words.length && TIME_WORDS[words[i + 1]] !== undefined && TIME_WORDS[words[i + 1]] < 10) {
            minutes += TIME_WORDS[words[i + 1]];
          }
          break;
        }
      }
    }
    
    // If we only got hours, check for single word
    if (hours === -1 && words.length === 1 && TIME_WORDS[words[0]] !== undefined) {
      hours = TIME_WORDS[words[0]];
    }
    
    if (hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59) {
      return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
    }
    
    return null;
  }
  
  // Get human-readable time type label
  function getTimeTypeLabel(timeType: string | undefined): string {
    switch (timeType) {
      case 'flocculation': return 'da floculação';
      case 'cut_point': return 'do ponto de corte';
      case 'press_start': return 'de início de prensa';
      default: return 'do evento';
    }
  }
  
  // Get Portuguese month name
  function getMonthName(month: number): string {
    const months = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 
                    'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
    return months[month - 1] || 'mês desconhecido';
  }
  
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
        // Time registration is now handled exclusively by LogTimeIntent with AMAZON.TIME slot
        // Redirect user to use proper time format for reliable recognition
        return { 
          speech: "Para registrar horários, diga: 'hora da floculação às quinze e trinta' ou 'hora do corte às 16 horas'. Use o formato com 'às' seguido do horário.", 
          shouldEndSession: false 
        };
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
        
        // === STAGE-AWARE INTENT GATING ===
        // If stage has pending required inputs, block all intents except:
        // - The expected intent for the stage
        // - AMAZON.HelpIntent and AMAZON.StopIntent (handled above)
        const activeBatchForGating = await batchService.getActiveBatch();
        if (activeBatchForGating) {
          const stageLock = recipeManager.getStageInputLock(activeBatchForGating.currentStageId);
          
          if (stageLock.locked && stageLock.expectedIntent) {
            // Check if inputs are satisfied
            const measurements = (activeBatchForGating.measurements as Record<string, any>) || {};
            const expectedInputs = recipeManager.getExpectedInputsForStage(activeBatchForGating.currentStageId);
            
            // Map stored_values to measurements keys
            const inputToMeasurementKey: Record<string, string> = {
              'flocculation_time': 'flocculation_time',
              'cut_point_time': 'cut_point_time',
              'press_start_time': 'press_start_time',
              'ph_value': 'initial_ph',
              'pieces_quantity': 'pieces_quantity',
              'chamber_2_entry_date': 'chamber_2_entry_date'
            };
            
            const pendingInputs = expectedInputs.filter(input => {
              const measurementKey = inputToMeasurementKey[input] || input;
              return measurements[measurementKey] === undefined;
            });
            
            const inputsSatisfied = pendingInputs.length === 0;
            
            // If inputs NOT satisfied and intent is NOT the expected one
            if (!inputsSatisfied && intentName !== stageLock.expectedIntent) {
              // Allow only specific intents that don't modify state
              const allowedIntents = ['AMAZON.HelpIntent', 'AMAZON.StopIntent', 'AMAZON.CancelIntent'];
              
              // Also allow status query via ProcessCommandIntent 
              // But NOT ProcessCommandIntent for anything else
              if (!allowedIntents.includes(intentName || '')) {
                console.log(`[GATING] Blocked intent ${intentName} at stage ${activeBatchForGating.currentStageId}. Expected: ${stageLock.expectedIntent}`);
                return res.status(200).json(buildAlexaResponse(
                  stageLock.inputPrompt || `Esta etapa requer input específico.`,
                  false,
                  `Use o comando apropriado para esta etapa.`
                ));
              }
            }
          }
        }
        
        // --- LogTimeIntent: Structured time registration with AMAZON.TIME slot ---
        // This intent uses native Alexa time recognition for reliable parsing
        if (intentName === "LogTimeIntent") {
          console.log("LogTimeIntent received:", JSON.stringify(slots, null, 2));
          
          const activeBatch = await batchService.getActiveBatch();
          if (!activeBatch) {
            return res.status(200).json(buildAlexaResponse(
              "Não há lote ativo para registrar horário.",
              false,
              "O que mais posso ajudar?"
            ));
          }
          
          // Extract time type from custom slot
          const timeTypeSlot = slots.timeType?.value || slots.time_type?.value;
          
          // Map slot values to internal time types and expected stages
          // timeType → stageId mapping ensures intent is only used at correct stage
          const timeTypeMapping: Record<string, { timeType: string; expectedStage: number; label: string }> = {
            'flocculation': { timeType: 'flocculation', expectedStage: 6, label: 'floculação' },
            'cut_point': { timeType: 'cut_point', expectedStage: 7, label: 'ponto de corte' },
            'press_start': { timeType: 'press_start', expectedStage: 14, label: 'início de prensa' }
          };
          
          let timeType: string | undefined;
          let expectedStage: number | undefined;
          
          if (timeTypeSlot) {
            const normalizedType = timeTypeSlot.toLowerCase();
            if (normalizedType.includes("floc") || normalizedType === "floculação" || normalizedType === "floculacao") {
              timeType = "flocculation";
              expectedStage = 6;
            } else if (normalizedType.includes("corte") || normalizedType === "ponto") {
              timeType = "cut_point";
              expectedStage = 7;
            } else if (normalizedType.includes("prensa") || normalizedType.includes("moldagem")) {
              timeType = "press_start";
              expectedStage = 14;
            }
          }
          
          // STAGE VALIDATION: Reject if not at the expected stage
          if (expectedStage && activeBatch.currentStageId !== expectedStage) {
            const currentStage = recipeManager.getStage(activeBatch.currentStageId);
            const typeInfo = timeType ? timeTypeMapping[timeType] : null;
            return res.status(200).json(buildAlexaResponse(
              `Não é possível registrar horário de ${typeInfo?.label || 'evento'} nesta etapa. Estamos na etapa ${activeBatch.currentStageId}: ${currentStage?.name || 'em andamento'}.`,
              false,
              "O que mais posso ajudar?"
            ));
          }
          
          // Extract time from AMAZON.TIME slot
          // AMAZON.TIME formats: "15:30", "T15:30", "2026-01-08T15:30", "now", "MO", "AF", "EV", "NI"
          let timeSlot = slots.time?.value;
          
          // Normalize AMAZON.TIME value to HH:MM format
          // AMAZON.TIME can return: "15:30", "T15:30", "T15:30:00", "2026-01-08T15:30:00", "17", "now", "MO", "AF", "EV", "NI"
          let timeValue: string | null = null;
          if (timeSlot) {
            // Handle special values
            if (timeSlot === "now" || timeSlot === "agora") {
              timeValue = parseSpokenTime("agora");
            }
            // Handle period values (MO=morning, AF=afternoon, EV=evening, NI=night)
            else if (timeSlot === "MO" || timeSlot === "AF" || timeSlot === "EV" || timeSlot === "NI") {
              // Use current Brasília time for period-based inputs
              timeValue = parseSpokenTime("agora");
            }
            // Handle ISO format with T prefix: T15:30, T15:30:00, 2026-01-08T15:30:00+00:00
            else if (timeSlot.includes("T")) {
              const timeMatch = timeSlot.match(/T(\d{1,2}):(\d{2})/);
              if (timeMatch) {
                timeValue = `${timeMatch[1].padStart(2, '0')}:${timeMatch[2]}`;
              }
            }
            // Handle HH:MM or HH:MM:SS format directly
            else if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(timeSlot)) {
              const parts = timeSlot.split(":");
              timeValue = `${parts[0].padStart(2, '0')}:${parts[1]}`;
            }
            // Handle bare hour (e.g., "17" for 5 PM)
            else if (/^\d{1,2}$/.test(timeSlot)) {
              const hour = parseInt(timeSlot, 10);
              if (hour >= 0 && hour <= 23) {
                timeValue = `${String(hour).padStart(2, '0')}:00`;
              }
            }
          }
          
          // If no valid time, ask for it
          if (!timeValue) {
            const typeLabel = getTimeTypeLabel(timeType);
            return res.status(200).json(buildAlexaResponse(
              `Por favor, diga o horário ${typeLabel}. Por exemplo: 'hora da floculação às quinze e trinta'.`,
              false,
              `Qual foi a hora ${typeLabel}?`
            ));
          }
          
          // Log the time
          const logResult = await batchService.logTime(activeBatch.id, timeValue, timeType);
          if (!logResult.success) {
            return res.status(200).json(buildAlexaResponse(
              logResult.error || "Erro ao registrar horário.",
              false,
              "O que mais posso ajudar?"
            ));
          }
          
          const typeLabel = getTimeTypeLabel(timeType);
          return res.status(200).json(buildAlexaResponse(
            `Hora ${typeLabel} registrada às ${timeValue}.`,
            false,
            "O que mais posso ajudar?"
          ));
        }
        
        // --- RegisterPHAndPiecesIntent: Structured pH and pieces registration (Stage 13) ---
        // Uses Dialog.ElicitSlot for step-by-step collection: first pH, then pieces
        // CRITICAL: Every branch must return a valid Alexa response - never empty {}
        if (intentName === "RegisterPHAndPiecesIntent") {
          console.log("RegisterPHAndPiecesIntent received:", JSON.stringify(slots, null, 2));
          
          const activeBatch = await batchService.getActiveBatch();
          if (!activeBatch) {
            return res.status(200).json(buildAlexaResponse(
              "Não há lote ativo para registrar pH e quantidade de peças.",
              false,
              "O que mais posso ajudar?"
            ));
          }
          
          // Check if we're at the correct stage (13)
          const currentStage = recipeManager.getStage(activeBatch.currentStageId);
          if (activeBatch.currentStageId !== 13) {
            return res.status(200).json(buildAlexaResponse(
              `Esta etapa não requer pH e quantidade de peças. Estamos na etapa ${activeBatch.currentStageId}: ${currentStage?.name || 'em andamento'}.`,
              false,
              "O que mais posso ajudar?"
            ));
          }
          
          // Extract pH value from slot with normalization (54 -> 5.4)
          const phSlot = slots.ph_value?.value || slots.phValue?.value;
          const piecesSlot = slots.pieces_quantity?.value || slots.piecesQuantity?.value || slots.pieces?.value;
          
          console.log(`[Stage 13] Slots received - pH: ${phSlot}, pieces: ${piecesSlot}`);
          
          // Check what's already registered in measurements
          const measurements = (activeBatch.measurements as Record<string, any>) || {};
          const existingPh = measurements["initial_ph"];
          const existingPieces = measurements["pieces_quantity"];
          
          console.log(`[Stage 13] Existing values - pH: ${existingPh}, pieces: ${existingPieces}`);
          
          // Normalize pH value
          let phValue: number | undefined;
          let phError: string | undefined;
          if (phSlot) {
            const normalized = normalizePHValue(phSlot);
            if (normalized !== null) {
              phValue = normalized;
            } else {
              phError = "pH inválido";
            }
          }
          
          // Parse pieces quantity
          let piecesQuantity: number | undefined;
          if (piecesSlot && piecesSlot !== "?") {
            const parsed = parseInt(piecesSlot, 10);
            if (!isNaN(parsed) && parsed > 0) {
              piecesQuantity = parsed;
            }
          }
          
          console.log(`[Stage 13] Parsed values - pH: ${phValue}, pieces: ${piecesQuantity}`);
          
          // Determine the final pH to use (prefer new value over existing)
          const effectivePh = phValue ?? existingPh;
          const effectivePieces = piecesQuantity ?? existingPieces;
          
          // Step 1: If we have no pH at all, elicit it
          if (effectivePh === undefined) {
            const prompt = phError 
              ? `${phError}. Qual é o pH inicial? Diga, por exemplo: 'cinco vírgula quatro'.`
              : "Qual é o pH inicial? Diga, por exemplo: 'cinco vírgula quatro'.";
            console.log(`[Stage 13] Eliciting pH`);
            return res.status(200).json(buildAlexaElicitSlotResponse(
              "ph_value",
              "RegisterPHAndPiecesIntent",
              prompt,
              "Qual é o pH inicial?",
              slots
            ));
          }
          
          // Step 2: If we have pH but no pieces, save pH and elicit pieces
          if (effectivePieces === undefined) {
            // Always save the current pH value (may be new or existing)
            if (phValue !== undefined) {
              measurements["initial_ph"] = phValue;
              await storage.updateBatch(activeBatch.id, { measurements });
              console.log(`[Stage 13] pH ${phValue} saved. Eliciting pieces.`);
            }
            
            const savedPh = phValue ?? existingPh;
            // IMPORTANT: Prompt must match intent model samples: "{pieces_quantity} peças" or "são {pieces_quantity} peças"
            const prompt = `pH ${savedPh} registrado. Quantas peças foram enformadas? Diga, por exemplo: seis peças.`;
            return res.status(200).json(buildAlexaElicitSlotResponse(
              "pieces_quantity",
              "RegisterPHAndPiecesIntent",
              prompt,
              "Quantas peças? Diga, por exemplo: seis peças.",
              slots
            ));
          }
          
          // Step 3: Both values present - save and confirm
          // Save/update values
          if (phValue !== undefined) {
            measurements["initial_ph"] = phValue;
          }
          if (piecesQuantity !== undefined) {
            measurements["pieces_quantity"] = piecesQuantity;
          }
          
          // Add to history for tracking
          const history = measurements._history || [];
          if (phValue !== undefined) {
            history.push({
              key: "initial_ph",
              value: phValue,
              stageId: 13,
              timestamp: new Date().toISOString()
            });
          }
          if (piecesQuantity !== undefined) {
            history.push({
              key: "pieces_quantity",
              value: piecesQuantity,
              stageId: 13,
              timestamp: new Date().toISOString()
            });
          }
          measurements._history = history;
          
          await storage.updateBatch(activeBatch.id, { measurements });
          console.log(`[Stage 13] Complete: pH ${effectivePh}, ${effectivePieces} pieces saved.`);
          
          return res.status(200).json(buildAlexaResponse(
            `pH ${effectivePh} e ${effectivePieces} peças registrados. Etapa concluída. Diga 'avançar' para continuar.`,
            false,
            "Diga 'avançar' para continuar."
          ));
        }
        
        // --- RegisterChamberEntryDateIntent: Structured date registration (Stage 19) ---
        if (intentName === "RegisterChamberEntryDateIntent") {
          console.log("RegisterChamberEntryDateIntent received:", JSON.stringify(slots, null, 2));
          
          const activeBatch = await batchService.getActiveBatch();
          if (!activeBatch) {
            return res.status(200).json(buildAlexaResponse(
              "Não há lote ativo para registrar data de entrada na câmara.",
              false,
              "O que mais posso ajudar?"
            ));
          }
          
          // Check if we're at the correct stage (19)
          const currentStage = recipeManager.getStage(activeBatch.currentStageId);
          if (activeBatch.currentStageId !== 19) {
            return res.status(200).json(buildAlexaResponse(
              `Esta etapa não requer data de entrada na câmara. Estamos na etapa ${activeBatch.currentStageId}: ${currentStage?.name || 'em andamento'}.`,
              false,
              "O que mais posso ajudar?"
            ));
          }
          
          // Extract date from AMAZON.DATE slot
          // AMAZON.DATE returns formats like: "2026-01-15", "2026-01", "2026-W03", "2026-01-15" for specific dates
          // Special values: "XXXX-WXX-WE" for weekend, "today", "tomorrow", "yesterday"
          const dateSlot = slots.entry_date?.value || slots.entryDate?.value || slots.date?.value;
          
          let dateValue: string | null = null;
          
          if (dateSlot) {
            // Handle "today" equivalent (Alexa returns current date in YYYY-MM-DD format)
            if (/^\d{4}-\d{2}-\d{2}$/.test(dateSlot)) {
              dateValue = dateSlot;
            }
            // Handle relative dates that Alexa might resolve
            else if (dateSlot.toLowerCase() === "today" || dateSlot === "hoje") {
              const now = new Date();
              // Adjust to Brasília timezone
              const brasiliaOffset = -3 * 60; // UTC-3 in minutes
              const localTime = new Date(now.getTime() + (brasiliaOffset - now.getTimezoneOffset()) * 60000);
              dateValue = localTime.toISOString().split('T')[0];
            }
          }
          
          if (!dateValue) {
            return res.status(200).json(buildAlexaResponse(
              "Por favor, informe a data de entrada na câmara 2. Diga: 'entrada na câmara dois hoje' ou 'entrada na câmara dois dia quinze de janeiro'.",
              false,
              "Qual a data de entrada na câmara 2?"
            ));
          }
          
          // Save the date
          const measurements = (activeBatch.measurements as Record<string, any>) || {};
          measurements["chamber_2_entry_date"] = dateValue;
          
          // Calculate maturation end date (90 days)
          const entryDate = new Date(dateValue);
          entryDate.setDate(entryDate.getDate() + 90);
          const maturationEndDate = entryDate.toISOString().split('T')[0];
          
          await storage.updateBatch(activeBatch.id, { 
            measurements,
            chamber2EntryDate: new Date(dateValue)
          });
          console.log(`[Stage 19] Chamber 2 entry date registered: ${dateValue}, maturation ends: ${maturationEndDate}`);
          
          // Format date for speech
          const dateParts = dateValue.split('-');
          const formattedDate = `${parseInt(dateParts[2])} de ${getMonthName(parseInt(dateParts[1]))}`;
          
          return res.status(200).json(buildAlexaResponse(
            `Data de entrada na câmara 2 registrada: ${formattedDate}. A maturação de 90 dias terminará em ${parseInt(maturationEndDate.split('-')[2])} de ${getMonthName(parseInt(maturationEndDate.split('-')[1]))}. Diga 'avançar' para continuar.`,
            false,
            "Diga 'avançar' para continuar."
          ));
        }
        
        // --- ProcessCommandIntent: Main voice command processing ---
        // This is the ONLY custom intent - all voice commands come through here
        if (intentName === "ProcessCommandIntent") {
          // Log the full slots structure for debugging
          console.log("Alexa slots received:", JSON.stringify(slots, null, 2));
          
          // Note: Stage input lock is now handled by executeIntent blocking log_time when LogTimeIntent should be used
          // ProcessCommandIntent is allowed for status/help/advance commands even at locked stages
          
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
          
          // Note: Time registration now uses LogTimeIntent exclusively
          
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
          const result = await executeIntent(command) as any;
          
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
