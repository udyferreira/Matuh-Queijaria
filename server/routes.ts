import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { api } from "@shared/routes";
import { CHEESE_TYPES, getCheeseTypeName } from "@shared/schema";
import { recipeManager, getTimerDurationMinutes, getIntervalDurationMinutes, TEST_MODE } from "./recipe";
import { registerChatRoutes } from "./replit_integrations/chat";
import { registerImageRoutes } from "./replit_integrations/image";
import * as batchService from "./batchService";
import * as speechRenderer from "./speechRenderer";
import { getApiContext as extractApiContext, cancelAllBatchReminders, scheduleReminderForWait, cancelReminder, buildPermissionCard, type ApiContext, type ScheduledAlert } from "./alexaReminders";
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
      completedAt: new Date(),
      scheduledAlerts: {}
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
      cancelReason: reason,
      scheduledAlerts: {}
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

    // Handle chamber_2_entry_date (Stage 19) - use centralized function
    if (key === 'chamber_2_entry_date') {
      const result = await batchService.recordChamber2Entry(batchId, value, { unit, notes });
      if (!result.success) {
        return res.status(400).json({ message: result.error, code: result.code });
      }
      // recordChamber2Entry handles all updates including measurements, so skip inline update
      await storage.logBatchAction({
        batchId,
        stageId: batch.currentStageId,
        action: "canonical_input",
        details: { key, value, unit, notes }
      });
      const updatedBatch = await storage.getBatch(batchId);
      return res.json(updatedBatch);
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
        : "Medir pH novamente ou aguardar até 1 hora e 30 minutos";
    }

    res.json(response);
  });

  app.put("/api/batches/:id/measurements", async (req, res) => {
    const batchId = Number(req.params.id);
    const { key, value, historyIndex, stageId } = req.body;

    if (!key || value === undefined) {
      return res.status(400).json({ message: "key e value são obrigatórios" });
    }

    const batch = await storage.getBatch(batchId);
    if (!batch) return res.status(404).json({ message: "Lote não encontrado" });

    const measurements = (batch.measurements as any) || {};
    const oldValue = measurements[key];

    if (key === "chamber_2_entry_date") {
      const entryDate = new Date(value);
      if (isNaN(entryDate.getTime())) {
        return res.status(400).json({ message: "Data inválida" });
      }
      const matEnd = new Date(entryDate);
      matEnd.setDate(matEnd.getDate() + 90);
      await storage.updateBatch(batchId, {
        chamber2EntryDate: entryDate,
        maturationEndDate: matEnd,
      });
    } else {
      if (historyIndex !== undefined && measurements._history) {
        const history = measurements._history as Array<{ key: string; value: any; stageId: number; timestamp: string }>;
        if (historyIndex >= 0 && historyIndex < history.length && history[historyIndex].key === key) {
          history[historyIndex].value = value;
          history[historyIndex].timestamp = new Date().toISOString();
        }
      }

      if (key === "ph_value" || key === "initial_ph") {
        if (stageId === 13) {
          measurements.initial_ph = value;
        }
        measurements[key] = value;
        if (measurements.ph_measurements && stageId) {
          const pmArr = measurements.ph_measurements as Array<{ value: any; stageId: number; timestamp: string }>;
          const match = pmArr.find((m) => m.stageId === stageId);
          if (match) match.value = value;
        }
      } else {
        measurements[key] = value;
      }

      await storage.updateBatch(batchId, { measurements });
    }

    await storage.logBatchAction({
      batchId,
      stageId: stageId || batch.currentStageId,
      action: "measurement_edit",
      details: { key, oldValue, newValue: value, historyIndex },
    });

    const updated = await storage.getBatch(batchId);
    res.json(updated);
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
    repromptText?: string,
    sessionAttributes?: Record<string, any>,
    card?: any
  ) {
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
    
    if (card) {
      response.response.card = card;
    }
    
    if (sessionAttributes && Object.keys(sessionAttributes).length > 0) {
      response.sessionAttributes = sessionAttributes;
    }
    
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
    currentSlots?: Record<string, any>,
    sessionAttributes?: Record<string, any>
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
    
    if (sessionAttributes && Object.keys(sessionAttributes).length > 0) {
      response.sessionAttributes = sessionAttributes;
    }
    
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
  
  // normalizePHValue is now centralized in batchService.ts
  
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
    command: Awaited<ReturnType<typeof interpretCommand>>,
    pendingInputReminder?: string,
    resolvedBatch?: any,
    apiCtxParam?: ApiContext | null,
    alexaUserId?: string | null
  ): Promise<{ speech: string; shouldEndSession: boolean; card?: any }> {
    
    const activeBatch = resolvedBatch || await batchService.getActiveBatch();
    
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
            speech: `Para iniciar o lote, faltam: ${missing.join(", ")}. Diga: 'iniciar novo lote com 130 litros, temperatura 32 graus, pH seis vírgula cinco'.`,
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
          const payload = speechRenderer.buildErrorPayload(result.error || "Erro ao iniciar lote.");
          const speech = await speechRenderer.renderSpeech(payload);
          return { speech, shouldEndSession: false };
        }
        
        if (alexaUserId && result.batch?.id) {
          await storage.setLastActiveBatch(alexaUserId, result.batch.id);
          console.log(`[start_batch] Persisted activeBatch=${result.batch.id} for user`);
        }
        const currentStage = recipeManager.getStage(result.batch.currentStageId || 3);
        const payload = speechRenderer.buildStartBatchPayload(result.batch, currentStage);
        const speech = await speechRenderer.renderSpeech(payload);
        return { speech, shouldEndSession: false };
      }
      
      case "status": {
        if (!activeBatch) {
          const payload = speechRenderer.buildErrorPayload(
            "Não há lote ativo no momento.",
            undefined
          );
          payload.allowedUtterances = ["iniciar novo lote com 130 litros, temperatura 32 graus, pH seis vírgula cinco"];
          const speech = await speechRenderer.renderSpeech(payload);
          return { speech, shouldEndSession: false };
        }
        const status = await batchService.getBatchStatus(activeBatch.id);
        if (!status) {
          return { speech: "Erro ao obter status.", shouldEndSession: false };
        }
        const stage = recipeManager.getStage(status.currentStageId);
        const payload = speechRenderer.buildStatusPayload(activeBatch, stage, "status", pendingInputReminder);
        const speech = await speechRenderer.renderSpeech(payload);
        return { speech, shouldEndSession: false };
      }
      
      case "advance": {
        if (!activeBatch) {
          return { speech: "Não há lote ativo para avançar.", shouldEndSession: false };
        }
        
        const result = await batchService.advanceBatch(activeBatch.id, apiCtxParam);
        
        if (!result.success) {
          const stage = recipeManager.getStage(activeBatch.currentStageId);
          const payload = speechRenderer.buildErrorPayload(result.error || "Não é possível avançar agora.", stage);
          const speech = await speechRenderer.renderSpeech(payload);
          return { speech, shouldEndSession: false };
        }
        
        if (result.completed) {
          if (alexaUserId) {
            await storage.clearLastActiveBatch(alexaUserId);
            console.log(`[advance] Batch completed, cleared persisted activeBatch for user`);
          }
          const payload = speechRenderer.buildAdvancePayload(activeBatch, null, true);
          const speech = await speechRenderer.renderSpeech(payload);
          return { speech, shouldEndSession: false };
        }
        
        const updatedBatch = result.batch || activeBatch;
        const nextStage = recipeManager.getStage(result.nextStage?.id || 0);
        const payload = speechRenderer.buildAdvancePayload(updatedBatch, nextStage, false);
        let speech = await speechRenderer.renderSpeech(payload);
        
        if (result.reminderScheduled && result.waitDurationText) {
          speech += ` Vou te avisar em ${result.waitDurationText}.`;
        } else if (result.needsReminderPermission && result.waitDurationText) {
          speech += ` Esta etapa dura ${result.waitDurationText}. Para eu avisar quando terminar, habilite as permissões de lembrete no app da Alexa.`;
          const { card } = buildPermissionCard();
          return { speech, shouldEndSession: false, card };
        } else if (result.needsReminderPermission) {
          speech += ' Para eu avisar quando o tempo acabar, abra o app da Alexa e habilite as permissões de lembrete para esta skill.';
          const { card } = buildPermissionCard();
          return { speech, shouldEndSession: false, card };
        }
        
        return { speech, shouldEndSession: false };
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
          const result = await batchService.recordChamber2Entry(activeBatch.id, dateValue);
          if (!result.success) {
            return { speech: result.error || "Erro ao registrar data.", shouldEndSession: false };
          }
          return { speech: `Data de entrada na câmara dois ${dateValue} registrada. Maturação termina em 90 dias.`, shouldEndSession: false };
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
          const normalizedTemp = batchService.normalizeTemperatureValue(numberValue);
          if (normalizedTemp === null) {
            return { speech: `Temperatura ${numberValue} não parece válida. Diga um valor entre 0 e 50 graus.`, shouldEndSession: false };
          }
          const measurements = (activeBatch.measurements as Record<string, any>) || {};
          measurements["current_temperature"] = normalizedTemp;
          await storage.updateBatch(activeBatch.id, { measurements });
          return { speech: `Temperatura ${normalizedTemp} graus registrada.`, shouldEndSession: false };
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
        return { speech: "Lote pausado. Diga 'quero retomar' quando quiser continuar.", shouldEndSession: false };
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
        if (!stage) {
          return { speech: "Etapa não encontrada.", shouldEndSession: false };
        }
        const payload = speechRenderer.buildStatusPayload(activeBatch, stage, "instructions", pendingInputReminder);
        if (stage.llm_guidance) {
          payload.notes = payload.notes 
            ? `${payload.notes} Dica: ${stage.llm_guidance}` 
            : `Dica: ${stage.llm_guidance}`;
        }
        const speech = await speechRenderer.renderSpeech(payload);
        return { speech, shouldEndSession: false };
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
        
        const value = calculatedInputs[inputType];
        if (value === undefined) {
          const inputNames: Record<string, string> = {
            "FERMENT_LR": "fermento LR",
            "FERMENT_DX": "fermento DX",
            "FERMENT_KL": "fermento KL",
            "RENNET": "coalho"
          };
          return { speech: `O insumo ${inputNames[inputType] || inputType} não foi encontrado.`, shouldEndSession: false };
        }
        
        const payload = speechRenderer.buildQueryInputPayload(inputType, value);
        const speech = await speechRenderer.renderSpeech(payload);
        return { speech, shouldEndSession: false };
      }
      
      case "repeat_doses": {
        if (!activeBatch) {
          return { speech: "Não há lote ativo para consultar as doses.", shouldEndSession: false };
        }
        const payload = speechRenderer.buildRepeatDosesPayload(activeBatch);
        const speech = await speechRenderer.renderSpeech(payload);
        return { speech, shouldEndSession: false };
      }
      
      case "help": {
        const stage = activeBatch ? recipeManager.getStage(activeBatch.currentStageId) : undefined;
        const payload = speechRenderer.buildHelpPayload(stage, activeBatch);
        const speech = await speechRenderer.renderSpeech(payload);
        return { speech, shouldEndSession: false };
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

  function formatDatePtBr(isoDateStr: string): string {
    try {
      const date = new Date(isoDateStr);
      const day = date.getUTCDate();
      const month = date.getUTCMonth() + 1;
      return `${day} de ${getMonthName(month)}`;
    } catch {
      return isoDateStr;
    }
  }

  async function getActiveBatchForUser(userId: string) {
    const lastId = await storage.getLastActiveBatch(userId);
    if (!lastId) return null;
    const batch = await batchService.getBatch(lastId);
    if (!batch) return null;
    if (batch.status !== "active" && (batch.status as string) !== "in_progress") {
      await storage.clearLastActiveBatch(userId);
      return null;
    }
    return batch;
  }

  async function resolveActiveBatch(userId: string | null) {
    if (userId) {
      const lastBatchId = await storage.getLastActiveBatch(userId);
      if (lastBatchId) {
        const batch = await batchService.getBatch(lastBatchId);
        if (batch && (batch.status === "active" || (batch.status as string) === "in_progress")) {
          console.log(`[resolveActiveBatch] Using persisted batch id=${batch.id} stage=${batch.currentStageId} for user=${userId.substring(0, 20)}...`);
          return batch;
        }
        console.log(`[resolveActiveBatch] Persisted batch id=${lastBatchId} not active, clearing for user=${userId.substring(0, 20)}...`);
        await storage.clearLastActiveBatch(userId);
      }
    }
    const batch = await batchService.getActiveBatch();
    if (batch) {
      console.log(`[resolveActiveBatch] Fallback to first active batch id=${batch.id} stage=${batch.currentStageId}`);
    }
    return batch;
  }

  async function buildBatchSelectionMenu(sessionAttrs: Record<string, any>): Promise<{ speechText: string; repromptText: string; newSessionAttrs: Record<string, any> }> {
    const batches = await batchService.listInProgressBatches();
    console.log(`[BATCH_MENU] count=${batches.length}`);

    if (batches.length === 0) {
      return {
        speechText: "Olá, não temos lotes em andamento. Vamos iniciar um novo lote? Para iniciar, diga: 'iniciar lote com cento e trinta litros temperatura trinta e dois graus pH seis vírgula cinco'.",
        repromptText: "Você quer iniciar um novo lote?",
        newSessionAttrs: { ...sessionAttrs, activeBatchId: undefined, state: undefined, batchChoices: undefined },
      };
    }

    if (batches.length === 1) {
      const b = batches[0];
      const dateStr = formatDatePtBr(b.startedAt);
      return {
        speechText: `Beleza, vamos continuar o lote do ${b.recipeName} iniciado em ${dateStr}. Você está na etapa ${b.currentStageId}: ${b.currentStageName}.`,
        repromptText: "O que deseja fazer?",
        newSessionAttrs: { ...sessionAttrs, activeBatchId: b.batchId, state: undefined, batchChoices: undefined },
      };
    }

    const batchChoices = batches.map((b, idx) => ({
      optionNumber: idx + 1,
      batchId: b.batchId,
      recipeName: b.recipeName,
      startedAt: b.startedAt,
      currentStageId: b.currentStageId,
      currentStageName: b.currentStageName,
    }));

    const optionsList = batchChoices.map(c => {
      const dateStr = formatDatePtBr(c.startedAt);
      return `Opção ${c.optionNumber}: ${c.recipeName}, iniciado em ${dateStr}, etapa ${c.currentStageId}: ${c.currentStageName}.`;
    }).join(' ');

    const repromptOptions = batchChoices.map(c => `'opção ${c.optionNumber}'`).join(', ');

    return {
      speechText: `Olá, temos ${batches.length} lotes em andamento. ${optionsList} Qual opção você quer continuar?`,
      repromptText: `Diga ${repromptOptions}.`,
      newSessionAttrs: { ...sessionAttrs, state: "AWAITING_BATCH_SELECTION", batchChoices },
    };
  }

  app.post("/api/alexa/webhook", async (req, res) => {
    try {
      const alexaRequest = req.body;
      const requestType = alexaRequest?.request?.type;
      const sessionAttributes: Record<string, any> = alexaRequest?.session?.attributes || {};
      const apiCtx = extractApiContext(alexaRequest);
      const userId: string | null = alexaRequest?.context?.System?.user?.userId || null;
      console.log(`[ALEXA_REQ] type=${requestType} apiCtx=${apiCtx ? 'present' : 'NULL'} userId=${userId ? userId.substring(0, 20) + '...' : 'NULL'}`);
      
      // --- LaunchRequest: Intelligent skill opening ---
      if (requestType === "LaunchRequest") {
        if (userId) {
          const lastBatchId = await storage.getLastActiveBatch(userId);
          if (lastBatchId) {
            const batch = await batchService.getBatch(lastBatchId);
            if (batch && (batch.status === "active" || (batch.status as string) === "in_progress")) {
              const stage = recipeManager.getStage(batch.currentStageId);
              const recipeName = recipeManager.getRecipeName();
              const speechText = `Etapa ${batch.currentStageId} do queijo ${recipeName}: ${stage?.name || 'em andamento'}. Continuar ou trocar de lote?`;
              console.log(`[LaunchRequest] Resuming persisted batch=${batch.id} stage=${batch.currentStageId} for user=${userId.substring(0, 20)}...`);
              return res.status(200).json(buildAlexaResponse(
                speechText,
                false,
                "Diga 'continuar' ou 'trocar lote'.",
                { activeBatchId: batch.id, state: "CONFIRM_CONTINUE_OR_SWITCH" }
              ));
            } else {
              await storage.clearLastActiveBatch(userId);
              console.log(`[LaunchRequest] Persisted batch=${lastBatchId} no longer active, cleared.`);
            }
          }
        }
        const { speechText, repromptText, newSessionAttrs } = await buildBatchSelectionMenu(sessionAttributes);
        console.log(`[LaunchRequest] No persisted batch, showing menu. activeBatchId=${newSessionAttrs.activeBatchId || 'none'} state=${newSessionAttrs.state || 'none'}`);
        if (userId && newSessionAttrs.activeBatchId) {
          await storage.setLastActiveBatch(userId, newSessionAttrs.activeBatchId);
        }
        return res.status(200).json(buildAlexaResponse(speechText, false, repromptText, newSessionAttrs));
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
        const dialogState = alexaRequest?.request?.dialogState || 'N/A';
        
        const activeBatchResolved = await resolveActiveBatch(userId);
        const stageForLog = activeBatchResolved?.currentStageId || 'no-batch';
        if (activeBatchResolved) {
          console.log(`[ACTIVE_BATCH] activeBatchId=${activeBatchResolved.id} stage=${stageForLog}`);
        }
        
        console.log(`[ALEXA_REQ] intent=${intentName} stage=${stageForLog} activeBatchId=${activeBatchResolved?.id || 'none'} dialogState=${dialogState} slots=${JSON.stringify(Object.fromEntries(Object.entries(slots).map(([k, v]: [string, any]) => [k, v?.value || '?'])))}`);
        
        // --- ContinueIntent / AMAZON.YesIntent: Continue with active batch ---
        if (intentName === "ContinueIntent" || intentName === "AMAZON.YesIntent") {
          const activeBatch = userId ? await getActiveBatchForUser(userId) : activeBatchResolved;
          if (activeBatch) {
            console.log(`[${intentName}] Continuing with batch=${activeBatch.id} stage=${activeBatch.currentStageId}`);
            const stage = recipeManager.getStage(activeBatch.currentStageId);
            const payload = speechRenderer.buildStatusPayload(activeBatch, stage, "status");
            const speech = await speechRenderer.renderSpeech(payload);
            return res.status(200).json(buildAlexaResponse(
              speech,
              false,
              "O que deseja fazer?",
              { ...sessionAttributes, activeBatchId: activeBatch.id, state: undefined }
            ));
          }
          console.log(`[${intentName}] No active batch found, showing menu`);
          const { speechText, repromptText, newSessionAttrs } = await buildBatchSelectionMenu(sessionAttributes);
          return res.status(200).json(buildAlexaResponse(speechText, false, repromptText, newSessionAttrs));
        }

        // --- ChangeBatchIntent / AMAZON.NoIntent: Switch to different batch ---
        if (intentName === "ChangeBatchIntent" || intentName === "AMAZON.NoIntent") {
          console.log(`[${intentName}] Showing batch selection menu`);
          const { speechText, repromptText, newSessionAttrs } = await buildBatchSelectionMenu(sessionAttributes);
          return res.status(200).json(buildAlexaResponse(speechText, false, repromptText, newSessionAttrs));
        }

        // --- SelectBatchIntent: Batch selection from multi-batch list ---
        if (intentName === "SelectBatchIntent") {
          const optionSlot = slots.option_number?.value || slots.optionNumber?.value;
          const optionNumber = optionSlot ? parseInt(optionSlot, 10) : NaN;
          
          console.log(`[SelectBatchIntent] optionNumber=${optionNumber} state=${sessionAttributes?.state || 'none'}`);
          
          if (sessionAttributes?.state !== "AWAITING_BATCH_SELECTION" || !sessionAttributes?.batchChoices) {
            return res.status(200).json(buildAlexaResponse(
              "Para trocar de lote, diga 'trocar lote'.",
              false,
              "Diga 'trocar lote' para ver os lotes disponíveis.",
              sessionAttributes
            ));
          }
          
          const choices = sessionAttributes.batchChoices as Array<{ optionNumber: number; batchId: number; recipeName: string; startedAt: string; currentStageId: number; currentStageName: string }>;
          
          if (isNaN(optionNumber) || optionNumber < 1 || optionNumber > choices.length) {
            const validRange = choices.map(c => `'opção ${c.optionNumber}'`).join(', ');
            return res.status(200).json(buildAlexaResponse(
              `Opção inválida. Escolha entre: ${validRange}.`,
              false,
              `Diga ${validRange}.`,
              sessionAttributes
            ));
          }
          
          const selected = choices.find(c => c.optionNumber === optionNumber)!;
          const dateStr = formatDatePtBr(selected.startedAt);
          
          if (userId) {
            await storage.setLastActiveBatch(userId, selected.batchId);
            console.log(`[SelectBatchIntent] Persisted activeBatch=${selected.batchId} for user=${userId.substring(0, 20)}...`);
          }
          
          const newSessionAttrs = { ...sessionAttributes, activeBatchId: selected.batchId, state: undefined, batchChoices: undefined };
          
          const speech = `Beleza, vamos continuar o lote do ${selected.recipeName} iniciado em ${dateStr}. Você está na etapa ${selected.currentStageId}: ${selected.currentStageName}.`;
          console.log(`[BATCH_SELECT] option=${optionNumber} batchId=${selected.batchId}`);
          
          return res.status(200).json(buildAlexaResponse(
            speech,
            false,
            "O que deseja fazer?",
            newSessionAttrs
          ));
        }
        
        // Handle Amazon built-in intents
        if (intentName === "AMAZON.CancelIntent" || intentName === "AMAZON.StopIntent") {
          return res.status(200).json(buildAlexaResponse("Até logo! Bom trabalho na queijaria.", true));
        }
        
        if (intentName === "AMAZON.HelpIntent") {
          const activeBatch = activeBatchResolved;
          const stage = activeBatch ? recipeManager.getStage(activeBatch.currentStageId) : undefined;
          const payload = speechRenderer.buildHelpPayload(stage, activeBatch);
          const speech = await speechRenderer.renderSpeech(payload);
          return res.status(200).json(buildAlexaResponse(speech, false, "Diga um comando.", sessionAttributes));
        }
        
        if (intentName === "AMAZON.FallbackIntent") {
          if (sessionAttributes?.state === "CONFIRM_CONTINUE_OR_SWITCH") {
            console.log(`[FallbackIntent] In CONFIRM_CONTINUE_OR_SWITCH state, prompting user`);
            return res.status(200).json(buildAlexaResponse(
              "Diga 'continuar' para seguir com o lote atual, ou 'trocar lote' para ver outros lotes.",
              false,
              "Diga 'continuar' ou 'trocar lote'.",
              sessionAttributes
            ));
          }
          if (sessionAttributes?.state === "AWAITING_BATCH_SELECTION") {
            const choices = sessionAttributes.batchChoices as Array<{ optionNumber: number }> | undefined;
            const validRange = choices?.map(c => `'opção ${c.optionNumber}'`).join(', ') || "'opção 1'";
            return res.status(200).json(buildAlexaResponse(
              `Não entendi. Diga ${validRange}.`,
              false,
              `Diga ${validRange}.`,
              sessionAttributes
            ));
          }
          const payload = speechRenderer.buildErrorPayload("Não entendi o comando.");
          payload.allowedUtterances = ["ajuda"];
          const speech = await speechRenderer.renderSpeech(payload);
          return res.status(200).json(buildAlexaResponse(speech, false, "Diga 'ajuda' para ver os comandos.", sessionAttributes));
        }
        
        // === STAGE-AWARE INTENT GATING ===
        const activeBatchForGating = activeBatchResolved;
        let pendingInputReminder: string | undefined;
        
        if (activeBatchForGating) {
          const stageLock = recipeManager.getStageInputLock(activeBatchForGating.currentStageId);
          
          if (stageLock.locked && stageLock.expectedIntent) {
            const currentStageForGating = recipeManager.getStage(activeBatchForGating.currentStageId);
            const pendingInputs = speechRenderer.getPendingInputs(
              activeBatchForGating, 
              activeBatchForGating.currentStageId,
              currentStageForGating
            );
            
            const inputsSatisfied = pendingInputs.length === 0;
            
            // Build friendly reminder about pending input
            if (!inputsSatisfied && pendingInputs.length > 0) {
              const inputLabels: Record<string, string> = {
                'flocculation_time': 'registrar horário de floculação',
                'cut_point_time': 'registrar horário do ponto de corte',
                'press_start_time': 'registrar horário da prensa',
                'ph_value': 'registrar pH',
                'initial_ph': 'registrar pH',
                'pieces_quantity': 'registrar quantidade de peças',
                'chamber_2_entry_date': 'registrar data de entrada na câmara 2'
              };
              pendingInputReminder = `Falta ${inputLabels[pendingInputs[0]] || pendingInputs[0]}.`;
              
              console.log(`[GATING] stage=${activeBatchForGating.currentStageId} intent=${intentName} pendingInputs=${pendingInputs.join(',')} expected=${stageLock.expectedIntent}`);
            }
            
            // If inputs NOT satisfied and intent is NOT the expected one
            if (!inputsSatisfied && intentName !== stageLock.expectedIntent) {
              // Allow read-only intents: HelpIntent, StopIntent, CancelIntent
              const systemIntents = ['AMAZON.HelpIntent', 'AMAZON.StopIntent', 'AMAZON.CancelIntent'];
              
              // ProcessCommandIntent is allowed for status/instructions/help queries
              // We'll let it through but add pendingInputReminder to the payload
              if (intentName === 'ProcessCommandIntent') {
                // Let it through - we'll add notes with the reminder below
                console.log(`[GATING] Allowing ProcessCommandIntent for read-only query at stage ${activeBatchForGating.currentStageId}`);
              } else if (!systemIntents.includes(intentName || '')) {
                // Block other intents
                console.log(`[GATING] Blocked intent ${intentName} at stage ${activeBatchForGating.currentStageId}. Expected: ${stageLock.expectedIntent}`);
                const stage = recipeManager.getStage(activeBatchForGating.currentStageId);
                const payload = speechRenderer.buildErrorPayload(
                  stageLock.inputPrompt || `Esta etapa requer input específico.`,
                  stage
                );
                payload.notes = pendingInputReminder;
                payload.allowedUtterances = speechRenderer.getContextualUtterances(stage, activeBatchForGating);
                const speech = await speechRenderer.renderSpeech(payload);
                return res.status(200).json(buildAlexaResponse(speech, false, `Use o comando apropriado para esta etapa.`, sessionAttributes));
              }
            }
          }
        }
        
        // --- AdvanceStageIntent: Deterministic stage advancement (no LLM) ---
        if (intentName === "AdvanceStageIntent") {
          const activeBatch = activeBatchResolved || (userId ? await getActiveBatchForUser(userId) : null);
          if (!activeBatch) {
            console.log(`[AdvanceStageIntent] No active batch, showing menu`);
            const { speechText, repromptText, newSessionAttrs } = await buildBatchSelectionMenu(sessionAttributes);
            return res.status(200).json(buildAlexaResponse(speechText, false, repromptText, newSessionAttrs));
          }

          console.log(`[AdvanceStageIntent] Advancing batch=${activeBatch.id} from stage=${activeBatch.currentStageId}`);
          const result = await batchService.advanceBatch(activeBatch.id, apiCtx);

          if (!result.success) {
            const stage = recipeManager.getStage(activeBatch.currentStageId);
            const payload = speechRenderer.buildErrorPayload(result.error || "Não é possível avançar agora.", stage);
            const speech = await speechRenderer.renderSpeech(payload);
            return res.status(200).json(buildAlexaResponse(speech, false, "O que mais posso ajudar?", sessionAttributes));
          }

          if (result.completed) {
            if (userId) {
              await storage.clearLastActiveBatch(userId);
              console.log(`[AdvanceStageIntent] Batch completed, cleared persisted activeBatch`);
            }
            const payload = speechRenderer.buildAdvancePayload(activeBatch, null, true);
            const speech = await speechRenderer.renderSpeech(payload);
            return res.status(200).json(buildAlexaResponse(speech, false, "O que mais posso ajudar?", sessionAttributes));
          }

          const updatedBatch = result.batch || activeBatch;
          const nextStage = recipeManager.getStage(result.nextStage?.id || 0);
          const payload = speechRenderer.buildAdvancePayload(updatedBatch, nextStage, false);
          let speech = await speechRenderer.renderSpeech(payload);
          let permCard: any = undefined;

          if (result.reminderScheduled && result.waitDurationText) {
            speech += ` Vou te avisar em ${result.waitDurationText}.`;
          } else if (result.needsReminderPermission && result.waitDurationText) {
            speech += ` Esta etapa dura ${result.waitDurationText}. Para eu avisar quando terminar, habilite as permissões de lembrete no app da Alexa.`;
            permCard = buildPermissionCard().card;
          } else if (result.needsReminderPermission) {
            speech += ' Para eu avisar quando o tempo acabar, abra o app da Alexa e habilite as permissões de lembrete para esta skill.';
            permCard = buildPermissionCard().card;
          }

          return res.status(200).json(buildAlexaResponse(speech, false, "O que mais posso ajudar?", { ...sessionAttributes, activeBatchId: updatedBatch.id, state: undefined }, permCard));
        }

        // --- LogTimeIntent: Structured time registration with AMAZON.TIME slot ---
        // This intent uses native Alexa time recognition for reliable parsing
        if (intentName === "LogTimeIntent") {
          console.log("LogTimeIntent received:", JSON.stringify(slots, null, 2));
          
          const activeBatch = activeBatchResolved;
          if (!activeBatch) {
            return res.status(200).json(buildAlexaResponse(
              "Não há lote ativo para registrar horário.",
              false,
              "O que mais posso ajudar?",
              sessionAttributes
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
              "O que mais posso ajudar?",
              sessionAttributes
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
          
          // If no valid time, ask for it with correct example for the time type
          if (!timeValue) {
            const typeLabel = getTimeTypeLabel(timeType);
            // Provide correct example based on time type
            const examples: Record<string, string> = {
              'flocculation': 'hora da floculação às vinte e três e nove',
              'cut_point': 'hora do corte às quinze e trinta',
              'press_start': 'hora da prensa às dezesseis e dez'
            };
            const example = examples[timeType || ''] || 'hora da floculação às vinte e três e nove';
            console.log(`[LogTimeIntent] Missing time for ${timeType}, suggesting example: ${example}`);
            return res.status(200).json(buildAlexaResponse(
              `Por favor, diga o horário ${typeLabel}. Por exemplo: '${example}'.`,
              false,
              `Qual foi a hora ${typeLabel}?`,
              sessionAttributes
            ));
          }
          
          // Log the time - pass raw slot as fallback so batchService can try broader normalization
          const logResult = await batchService.logTime(activeBatch.id, timeValue, timeType || timeTypeSlot);
          if (!logResult.success) {
            return res.status(200).json(buildAlexaResponse(
              logResult.error || "Erro ao registrar horário.",
              false,
              "O que mais posso ajudar?",
              sessionAttributes
            ));
          }
          
          const typeLabel = getTimeTypeLabel(timeType);
          const confirmationMsg = `Hora ${typeLabel} registrada às ${timeValue}.`;
          
          const advanceResult = await batchService.advanceBatch(activeBatch.id, apiCtx);
          if (advanceResult.success && advanceResult.nextStage) {
            const nextStage = recipeManager.getStage(advanceResult.nextStage.id);
            const updatedBatch = await batchService.getBatch(activeBatch.id);
            console.log(`[LogTimeIntent] Auto-advancing to stage ${advanceResult.nextStage.id}.`);
            
            if (nextStage && updatedBatch) {
              const payload = speechRenderer.buildAutoAdvancePayload(confirmationMsg, updatedBatch, nextStage);
              let speech = await speechRenderer.renderSpeech(payload);
              let permCard: any = undefined;
              if (advanceResult.reminderScheduled && advanceResult.waitDurationText) {
                speech += ` Vou te avisar em ${advanceResult.waitDurationText}.`;
              } else if (advanceResult.needsReminderPermission && advanceResult.waitDurationText) {
                speech += ` Esta etapa dura ${advanceResult.waitDurationText}. Para eu avisar quando terminar, habilite as permissões de lembrete no app da Alexa.`;
                permCard = buildPermissionCard().card;
              } else if (advanceResult.needsReminderPermission) {
                speech += ' Para eu avisar quando o tempo acabar, abra o app da Alexa e habilite as permissões de lembrete para esta skill.';
                permCard = buildPermissionCard().card;
              }
              return res.status(200).json(buildAlexaResponse(speech, false, "O que mais posso ajudar?", sessionAttributes, permCard));
            }
          }
          
          // Fallback if advance failed or no next stage
          return res.status(200).json(buildAlexaResponse(
            confirmationMsg,
            false,
            "O que mais posso ajudar?",
            sessionAttributes
          ));
        }
        
        // --- RegisterPHAndPiecesIntent: Stage-aware pH registration ---
        // Stage 13: pH + pieces (multi-turn dialog)
        // Stage 15: pH only (loop control with turning cycles)
        // CRITICAL: Decision based on stageId, NOT intent name alone
        if (intentName === "RegisterPHAndPiecesIntent") {
          console.log("RegisterPHAndPiecesIntent received:", JSON.stringify(slots, null, 2));
          
          // Extract pH value from slot with normalization (54 -> 5.4)
          const phSlot = slots.ph_value?.value || slots.phValue?.value;
          const piecesSlot = slots.pieces_quantity?.value || slots.piecesQuantity?.value || slots.pieces?.value;
          
          // === INTENT MISROUTE GUARD ===
          // If BOTH ph_value AND pieces_quantity are absent/undefined/"?", this is likely a misroute
          // User probably said "avançar etapa" or "status" but Alexa sent wrong intent
          const phEmpty = !phSlot || phSlot === '?';
          const piecesEmpty = !piecesSlot || piecesSlot === '?';
          
          if (phEmpty && piecesEmpty) {
            const activeBatch = activeBatchResolved;
            const stageId = activeBatch?.currentStageId || 0;
            const currentStage = recipeManager.getStage(stageId);
            
            console.log(`[MISROUTE] intent=RegisterPHAndPiecesIntent stage=${stageId} missingSlots=ph_value,pieces_quantity dialogState=${alexaRequest?.request?.dialogState || 'N/A'}`);
            
            // Build contextual help based on current stage's pending inputs
            let helpMessage: string;
            if (activeBatch && currentStage) {
              const measurements = (activeBatch.measurements as Record<string, any>) || {};
              const requiredInputs = currentStage.operator_input_required || [];
              
              // Check what's actually needed at this stage
              if (stageId === 13 && measurements["initial_ph"] === undefined) {
                helpMessage = `Estamos na etapa ${stageId}: ${currentStage.name}. Para registrar o pH, diga: "pH cinco vírgula dois com doze peças".`;
              } else if (stageId === 15) {
                helpMessage = `Estamos na etapa ${stageId}: ${currentStage.name}. Para informar o pH, diga: "pH cinco vírgula dois".`;
              } else {
                // Stage doesn't require pH - suggest what IS valid
                const utterances = speechRenderer.getContextualUtterances(currentStage, activeBatch);
                const examples = utterances.slice(0, 2).map(u => `"${u}"`).join(' ou ');
                helpMessage = `Estamos na etapa ${stageId}: ${currentStage.name}. Você pode dizer ${examples}.`;
              }
            } else {
              helpMessage = "Não há lote ativo. Diga 'qual é o status' para verificar.";
            }
            
            return res.status(200).json(buildAlexaResponse(
              helpMessage,
              false,
              "O que mais posso ajudar?",
              sessionAttributes
            ));
          }
          
          const activeBatch = activeBatchResolved;
          if (!activeBatch) {
            return res.status(200).json(buildAlexaResponse(
              "Não há lote ativo para registrar pH.",
              false,
              "O que mais posso ajudar?",
              sessionAttributes
            ));
          }
          
          const stageId = activeBatch.currentStageId;
          const currentStage = recipeManager.getStage(stageId);
          
          console.log(`[Stage ${stageId}] Slots received - pH: ${phSlot}, pieces: ${piecesSlot}`);
          
          // Normalize pH value using centralized function
          let phValue: number | undefined;
          let phError: string | undefined;
          if (phSlot) {
            const normalized = batchService.normalizePHValue(phSlot);
            if (normalized !== null) {
              phValue = normalized;
            } else {
              phError = "pH inválido";
            }
          }
          
          // ============================================
          // STAGE 13: pH inicial + quantidade de peças
          // ============================================
          if (stageId === 13) {
            console.log(`[Stage 13] Processing pH and pieces registration`);
            
            const measurements = (activeBatch.measurements as Record<string, any>) || {};
            const existingPh = measurements["initial_ph"];
            const existingPieces = measurements["pieces_quantity"];
            
            console.log(`[Stage 13] Existing values - pH: ${existingPh}, pieces: ${existingPieces}`);
            
            // Parse pieces quantity
            let piecesQuantity: number | undefined;
            if (piecesSlot && piecesSlot !== "?") {
              const parsed = parseInt(piecesSlot, 10);
              if (!isNaN(parsed) && parsed > 0) {
                piecesQuantity = parsed;
              }
            }
            
            console.log(`[Stage 13] Parsed values - pH: ${phValue}, pieces: ${piecesQuantity}`);
            
            // Determine effective values (prefer new over existing)
            const effectivePh = phValue ?? existingPh;
            const effectivePieces = piecesQuantity ?? existingPieces;
            
            // Step 1: If we have no pH at all, elicit it
            if (effectivePh === undefined) {
              const prompt = phError 
                ? `${phError}. Qual é o pH inicial? Diga, por exemplo: 'cinco vírgula dois'.`
                : "Qual é o pH inicial? Diga, por exemplo: 'cinco vírgula dois'.";
              console.log(`[Stage 13] Eliciting pH`);
              return res.status(200).json(buildAlexaElicitSlotResponse(
                "ph_value",
                "RegisterPHAndPiecesIntent",
                prompt,
                "Qual é o pH inicial?",
                slots,
                sessionAttributes
              ));
            }
            
            // Step 2: If we have pH but no pieces, save pH and elicit pieces
            if (effectivePieces === undefined) {
              if (phValue !== undefined) {
                measurements["initial_ph"] = phValue;
                await storage.updateBatch(activeBatch.id, { measurements });
                console.log(`[Stage 13] pH ${phValue} saved. Eliciting pieces.`);
              }
              
              const savedPh = phValue ?? existingPh;
              const prompt = `pH ${savedPh} registrado. Quantas peças foram enformadas? Diga, por exemplo: seis peças.`;
              return res.status(200).json(buildAlexaElicitSlotResponse(
                "pieces_quantity",
                "RegisterPHAndPiecesIntent",
                prompt,
                "Quantas peças? Diga, por exemplo: seis peças.",
                slots,
                sessionAttributes
              ));
            }
            
            // Step 3: Both values present - use centralized logPh
            const result = await batchService.logPh(activeBatch.id, effectivePh, effectivePieces);
            
            if (!result.success) {
              return res.status(200).json(buildAlexaResponse(
                result.error || "Erro ao registrar valores.",
                false,
                "Tente novamente.",
                sessionAttributes
              ));
            }
            
            console.log(`[Stage 13] Complete: pH ${effectivePh}, ${effectivePieces} pieces saved via batchService.`);
            
            const confirmationMsg = `pH ${effectivePh} e ${effectivePieces} peças registrados.`;
            
            const advanceResult = await batchService.advanceBatch(activeBatch.id, apiCtx);
            if (advanceResult.success && advanceResult.nextStage) {
              const nextStage = recipeManager.getStage(advanceResult.nextStage.id);
              const updatedBatch = await batchService.getBatch(activeBatch.id);
              console.log(`[Stage 13] Auto-advancing to stage ${advanceResult.nextStage.id}.`);
              
              if (nextStage && updatedBatch) {
                const payload = speechRenderer.buildAutoAdvancePayload(confirmationMsg, updatedBatch, nextStage);
                let speech = await speechRenderer.renderSpeech(payload);
                let permCard: any = undefined;
                if (advanceResult.reminderScheduled && advanceResult.waitDurationText) {
                  speech += ` Vou te avisar em ${advanceResult.waitDurationText}.`;
                } else if (advanceResult.needsReminderPermission && advanceResult.waitDurationText) {
                  speech += ` Esta etapa dura ${advanceResult.waitDurationText}. Para eu avisar quando terminar, habilite as permissões de lembrete no app da Alexa.`;
                  permCard = buildPermissionCard().card;
                } else if (advanceResult.needsReminderPermission) {
                  speech += ' Para eu avisar quando o tempo acabar, abra o app da Alexa e habilite as permissões de lembrete para esta skill.';
                  permCard = buildPermissionCard().card;
                }
                return res.status(200).json(buildAlexaResponse(speech, false, "O que mais posso ajudar?", sessionAttributes, permCard));
              }
            }
            
            // Fallback if advance failed - confirm registration only
            return res.status(200).json(buildAlexaResponse(
              `${confirmationMsg} Diga 'avançar etapa' para continuar.`,
              false,
              "Diga 'avançar etapa' para continuar.",
              sessionAttributes
            ));
          }
          
          // ============================================
          // STAGE 15: Loop de viradas - só pH (ignora peças)
          // Uses centralized batchService.logPh()
          // ============================================
          if (stageId === 15) {
            console.log(`[Stage 15] Processing pH for turning loop`);
            
            // Step 1: If no pH provided, elicit it
            if (phValue === undefined) {
              const prompt = phError 
                ? `${phError}. Informe o pH atual dos queijos. Diga, por exemplo: 'pH cinco vírgula dois'.`
                : "Informe o pH atual dos queijos. Diga, por exemplo: 'pH cinco vírgula dois'.";
              console.log(`[Stage 15] Eliciting pH`);
              return res.status(200).json(buildAlexaElicitSlotResponse(
                "ph_value",
                "RegisterPHAndPiecesIntent",
                prompt,
                "Qual o pH atual?",
                slots,
                sessionAttributes
              ));
            }
            
            // Use centralized logPh function
            const result = await batchService.logPh(activeBatch.id, phValue);
            
            if (!result.success) {
              return res.status(200).json(buildAlexaResponse(
                result.error || "Erro ao registrar pH.",
                false,
                "Tente novamente.",
                sessionAttributes
              ));
            }
            
            const turningCycles = result.turningCyclesCount || 1;
            console.log(`[Stage 15] pH ${phValue} recorded. Turning cycles: ${turningCycles}`);
            
            if (result.shouldExitLoop) {
              // pH reached target - advance to next stage and vocalize it
              const confirmationMsg = `pH ${phValue} registrado. Valor ideal atingido! Queijos virados ${turningCycles} vezes.`;
              
              const advanceResult = await batchService.advanceBatch(activeBatch.id, apiCtx);
              if (advanceResult.success && advanceResult.nextStage) {
                const nextStage = recipeManager.getStage(advanceResult.nextStage.id);
                const updatedBatch = await batchService.getBatch(activeBatch.id);
                console.log(`[Stage 15] pH ${phValue} reached target. Loop complete. Auto-advancing to stage ${advanceResult.nextStage.id}.`);
                
                if (nextStage && updatedBatch) {
                  const payload = speechRenderer.buildAutoAdvancePayload(confirmationMsg, updatedBatch, nextStage);
                  let speech = await speechRenderer.renderSpeech(payload);
                  let permCard: any = undefined;
                  if (advanceResult.reminderScheduled && advanceResult.waitDurationText) {
                    speech += ` Vou te avisar em ${advanceResult.waitDurationText}.`;
                  } else if (advanceResult.needsReminderPermission && advanceResult.waitDurationText) {
                    speech += ` Esta etapa dura ${advanceResult.waitDurationText}. Para eu avisar quando terminar, habilite as permissões de lembrete no app da Alexa.`;
                    permCard = buildPermissionCard().card;
                  } else if (advanceResult.needsReminderPermission) {
                    speech += ' Para eu avisar quando o tempo acabar, abra o app da Alexa e habilite as permissões de lembrete para esta skill.';
                    permCard = buildPermissionCard().card;
                  }
                  return res.status(200).json(buildAlexaResponse(speech, false, "O que mais posso ajudar?", sessionAttributes, permCard));
                }
              }
              
              // Fallback if advance failed
              return res.status(200).json(buildAlexaResponse(
                `${confirmationMsg} Diga 'avançar etapa' para continuar.`,
                false,
                "Diga 'avançar etapa' para continuar.",
                sessionAttributes
              ));
            } else {
              // pH still above target - continue loop, schedule reminder for remaining time
              console.log(`[Stage 15] pH ${phValue} above target. Continue monitoring.`);
              
              let reminderMsg = '';
              let permCard: any = undefined;
              if (apiCtx) {
                try {
                  const updatedBatchForReminder = await batchService.getBatch(activeBatch.id);
                  const batchHistory = ((updatedBatchForReminder as any)?.history as any[]) || [];
                  const stageStartEntry = batchHistory.find((h: any) => h.stageId === 15 && h.action === 'start');
                  if (stageStartEntry) {
                    const loopStage = recipeManager.getStage(15);
                    const maxHours = loopStage?.max_loop_duration_hours || 1.5;
                    const maxDurationMs = TEST_MODE ? 2 * 60 * 1000 : maxHours * 60 * 60 * 1000;
                    const stageStartTime = new Date(stageStartEntry.timestamp).getTime();
                    const elapsed = Date.now() - stageStartTime;
                    const remainingMs = maxDurationMs - elapsed;
                    
                    if (remainingMs > 0) {
                      const remainingSeconds = Math.ceil(remainingMs / 1000);
                      const scheduledAlerts = ((updatedBatchForReminder as any)?.scheduledAlerts || {}) as Record<string, ScheduledAlert>;
                      const alertKey = 'stage_15';
                      if (scheduledAlerts[alertKey]) {
                        await cancelReminder(apiCtx, scheduledAlerts[alertKey].reminderId);
                        delete scheduledAlerts[alertKey];
                        await storage.updateBatch(activeBatch.id, { scheduledAlerts });
                      }
                      const reminderResult = await scheduleReminderForWait(
                        apiCtx,
                        { id: activeBatch.id, recipeId: (updatedBatchForReminder as any).recipeId },
                        15,
                        remainingSeconds
                      );
                      if (reminderResult.reminderId) {
                        scheduledAlerts[alertKey] = {
                          reminderId: reminderResult.reminderId,
                          stageId: 15,
                          dueAtISO: new Date(Date.now() + remainingSeconds * 1000).toISOString(),
                          kind: 'loop_timeout'
                        };
                        await storage.updateBatch(activeBatch.id, { scheduledAlerts });
                        const remainingMin = Math.round(remainingSeconds / 60);
                        reminderMsg = ` Vou te avisar em ${remainingMin} minuto${remainingMin !== 1 ? 's' : ''} se o tempo esgotar.`;
                        console.log(`[Stage 15] Reminder rescheduled for ${remainingSeconds}s (${remainingMin}min remaining)`);
                      } else if (reminderResult.permissionDenied) {
                        console.log(`[Stage 15] Reminder permission denied after pH log`);
                        reminderMsg = ' Para eu avisar quando o tempo acabar, habilite as permissões de lembrete no app da Alexa.';
                        permCard = buildPermissionCard().card;
                      }
                    } else {
                      console.log(`[Stage 15] Loop time already elapsed (${Math.round(-remainingMs/1000)}s past). No reminder scheduled.`);
                    }
                  }
                } catch (err) {
                  console.log(`[Stage 15] Error scheduling reminder after pH: ${err}`);
                }
              }
              
              return res.status(200).json(buildAlexaResponse(
                `pH ${phValue} registrado. Queijos virados ${turningCycles} vez${turningCycles > 1 ? 'es' : ''}.${reminderMsg} Continue monitorando ou informe novo pH.`,
                false,
                "Informe o próximo pH ou diga 'qual é o status' para ver o progresso.",
                sessionAttributes,
                permCard
              ));
            }
          }
          
          // ============================================
          // OTHER STAGES: Intent not valid here
          // ============================================
          return res.status(200).json(buildAlexaResponse(
            `Esta etapa não aceita registro de pH. Estamos na etapa ${stageId}: ${currentStage?.name || 'em andamento'}.`,
            false,
            "O que mais posso ajudar?",
            sessionAttributes
          ));
        }
        
        // --- RegisterChamberEntryDateIntent: Structured date registration (Stage 19) ---
        if (intentName === "RegisterChamberEntryDateIntent") {
          console.log("RegisterChamberEntryDateIntent received:", JSON.stringify(slots, null, 2));
          
          // Extract date from AMAZON.DATE slot
          // AMAZON.DATE returns formats like: "2026-01-15", "2026-01", "2026-W03", "2026-01-15" for specific dates
          const dateSlot = slots.entry_date?.value || slots.entryDate?.value || slots.date?.value;
          
          // === INTENT MISROUTE GUARD ===
          // If entry_date is absent/undefined/"?", this is likely a misroute
          const dateEmpty = !dateSlot || dateSlot === '?';
          
          if (dateEmpty) {
            const activeBatch = activeBatchResolved;
            const stageId = activeBatch?.currentStageId || 0;
            const currentStage = recipeManager.getStage(stageId);
            
            console.log(`[MISROUTE] intent=RegisterChamberEntryDateIntent stage=${stageId} missingSlots=entry_date dialogState=${alexaRequest?.request?.dialogState || 'N/A'}`);
            
            // Build contextual help based on current stage
            let helpMessage: string;
            if (activeBatch && currentStage) {
              if (stageId === 19) {
                helpMessage = `Estamos na etapa ${stageId}: ${currentStage.name}. Para registrar a data, diga: "coloquei na câmara dois hoje". Ou diga "qual é o status".`;
              } else {
                // Stage doesn't require date - suggest what IS valid
                const utterances = speechRenderer.getContextualUtterances(currentStage, activeBatch);
                const examples = utterances.slice(0, 2).map(u => `"${u}"`).join(' ou ');
                helpMessage = `Estamos na etapa ${stageId}: ${currentStage.name}. Você pode dizer ${examples}.`;
              }
            } else {
              helpMessage = "Não há lote ativo. Diga 'qual é o status' para verificar.";
            }
            
            return res.status(200).json(buildAlexaResponse(
              helpMessage,
              false,
              "O que mais posso ajudar?",
              sessionAttributes
            ));
          }
          
          const activeBatch = activeBatchResolved;
          if (!activeBatch) {
            return res.status(200).json(buildAlexaResponse(
              "Não há lote ativo para registrar data de entrada na câmara.",
              false,
              "O que mais posso ajudar?",
              sessionAttributes
            ));
          }
          
          // Check if we're at the correct stage (19)
          const currentStage = recipeManager.getStage(activeBatch.currentStageId);
          if (activeBatch.currentStageId !== 19) {
            const utterances = speechRenderer.getContextualUtterances(currentStage, activeBatch);
            const examples = utterances.slice(0, 2).map(u => `"${u}"`).join(' ou ');
            return res.status(200).json(buildAlexaResponse(
              `Estamos na etapa ${activeBatch.currentStageId}: ${currentStage?.name || 'em andamento'}. Você pode dizer ${examples}.`,
              false,
              "O que mais posso ajudar?",
              sessionAttributes
            ));
          }
          
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
              "Qual a data de entrada na câmara 2?",
              sessionAttributes
            ));
          }
          
          console.log(`[Stage 19] chamber2EntryDate BEFORE: ${(activeBatch as any).chamber2EntryDate || 'null'}`);
          
          // Use centralized function for chamber 2 entry
          const result = await batchService.recordChamber2Entry(activeBatch.id, dateValue);
          
          console.log(`[Stage 19] chamber2EntryDate AFTER: dateValue=${dateValue} success=${result.success}`);
          
          if (!result.success) {
            return res.status(200).json(buildAlexaResponse(
              result.error || "Erro ao registrar data.",
              false,
              "Tente novamente.",
              sessionAttributes
            ));
          }
          
          const maturationEndDate = result.maturationEndDateISO!.split('T')[0];
          console.log(`[Stage 19] Chamber 2 entry date registered: ${dateValue}, maturation ends: ${maturationEndDate}`);
          
          // Format date for speech
          const dateParts = dateValue.split('-');
          const formattedDate = `${parseInt(dateParts[2])} de ${getMonthName(parseInt(dateParts[1]))}`;
          const matDateParts = maturationEndDate.split('-');
          const formattedMatDate = `${parseInt(matDateParts[2])} de ${getMonthName(parseInt(matDateParts[1]))}`;
          
          const confirmationMsg = `Data de entrada na câmara 2 registrada: ${formattedDate}. A maturação de 90 dias terminará em ${formattedMatDate}.`;
          
          const advanceResult = await batchService.advanceBatch(activeBatch.id, apiCtx);
          if (advanceResult.success && advanceResult.nextStage) {
            const nextStage = recipeManager.getStage(advanceResult.nextStage.id);
            const updatedBatch = await batchService.getBatch(activeBatch.id);
            console.log(`[Stage 19] Auto-advancing to stage ${advanceResult.nextStage.id}.`);
            
            if (nextStage && updatedBatch) {
              const payload = speechRenderer.buildAutoAdvancePayload(confirmationMsg, updatedBatch, nextStage);
              let speech = await speechRenderer.renderSpeech(payload);
              let permCard: any = undefined;
              if (advanceResult.reminderScheduled && advanceResult.waitDurationText) {
                speech += ` Vou te avisar em ${advanceResult.waitDurationText}.`;
              } else if (advanceResult.needsReminderPermission && advanceResult.waitDurationText) {
                speech += ` Esta etapa dura ${advanceResult.waitDurationText}. Para eu avisar quando terminar, habilite as permissões de lembrete no app da Alexa.`;
                permCard = buildPermissionCard().card;
              } else if (advanceResult.needsReminderPermission) {
                speech += ' Para eu avisar quando o tempo acabar, abra o app da Alexa e habilite as permissões de lembrete para esta skill.';
                permCard = buildPermissionCard().card;
              }
              return res.status(200).json(buildAlexaResponse(speech, false, "O que mais posso ajudar?", sessionAttributes, permCard));
            }
          }
          
          // Fallback
          return res.status(200).json(buildAlexaResponse(
            `${confirmationMsg} Diga 'avançar etapa' para continuar.`,
            false,
            "Diga 'avançar etapa' para continuar.",
            sessionAttributes
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
              "Diga um comando completo como 'qual é o status' ou 'avançar etapa'.",
              sessionAttributes
            ));
          }
          
          const lowerText = textToInterpret.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
          
          // --- "trocar lote" handling: show full batch list ---
          if (lowerText.includes("trocar") && lowerText.includes("lote")) {
            console.log(`[ProcessCommandIntent] "trocar lote" detected, showing batch list`);
            const { speechText, repromptText, newSessionAttrs } = await buildBatchSelectionMenu(sessionAttributes);
            return res.status(200).json(buildAlexaResponse(speechText, false, repromptText, newSessionAttrs));
          }
          
          // --- "continuar"/"sim"/"prosseguir" handling: resume active batch ---
          const continueWords = ["continuar", "sim", "seguir", "prosseguir", "continue"];
          if (continueWords.some(w => lowerText === w || lowerText.startsWith(w + " "))) {
            const activeBatch = activeBatchResolved;
            if (activeBatch) {
              const stage = recipeManager.getStage(activeBatch.currentStageId);
              if (stage) {
                const payload = speechRenderer.buildStatusPayload(activeBatch, stage);
                const speech = await speechRenderer.renderSpeech(payload);
                console.log(`[ProcessCommandIntent] "continuar" → rendering status for batch=${activeBatch.id} stage=${stage.id}`);
                return res.status(200).json(buildAlexaResponse(speech, false, "O que mais posso ajudar?", sessionAttributes));
              }
            }
          }
          
          // LLM interprets the command, backend executes
          const command = await interpretCommand(textToInterpret);
          console.log("LLM interpreted command:", JSON.stringify(command));
          // Pass pendingInputReminder from GATING to status/instructions handlers
          const result = await executeIntent(command, pendingInputReminder, activeBatchResolved || undefined, apiCtx, userId) as any;
          
          return res.status(200).json(buildAlexaResponse(
            result.speech,
            result.shouldEndSession,
            result.shouldEndSession ? undefined : "O que mais posso ajudar?",
            sessionAttributes,
            result.card
          ));
        }
        
        // Unknown intent - treat as fallback
        return res.status(200).json(buildAlexaResponse(
          "Comando não reconhecido. Diga 'ajuda' para ver as opções.",
          false,
          "Diga 'ajuda' para ver os comandos.",
          sessionAttributes
        ));
      }
      
      // Fallback for unknown request types
      return res.status(200).json(buildAlexaResponse(
        "Desculpe, não consegui processar sua solicitação.",
        false,
        "Diga 'ajuda' para ver os comandos.",
        sessionAttributes
      ));
      
    } catch (error) {
      console.error("Alexa webhook error:", error);
      const catchSessionAttrs = req.body?.session?.attributes || {};
      return res.status(200).json(buildAlexaResponse(
        "Ocorreu um erro. Tente novamente.",
        false,
        "Diga 'ajuda' para ver os comandos.",
        catchSessionAttrs
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
