import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { api } from "@shared/routes";
import { recipeManager } from "./recipe";
import { registerChatRoutes } from "./replit_integrations/chat";
import { registerImageRoutes } from "./replit_integrations/image";
import { z } from "zod";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  
  // Register AI Integrations
  registerChatRoutes(app);
  registerImageRoutes(app);

  // --- Batch Routes ---

  app.post(api.batches.start.path, async (req, res) => {
    try {
      const { milkVolumeL } = api.batches.start.input.parse(req.body);
      
      // Calculate inputs immediately
      const inputs = recipeManager.calculateInputs(milkVolumeL);

      const batch = await storage.createBatch({
        recipeId: "QUEIJO_NETE",
        currentStageId: 1, // Start at stage 1
        milkVolumeL: milkVolumeL.toString(),
        calculatedInputs: inputs,
        status: "active",
        history: [{ 
            stageId: 1, 
            action: "start", 
            timestamp: new Date().toISOString() 
        }]
      });

      await storage.logBatchAction({
        batchId: batch.id,
        stageId: 1,
        action: "start",
        details: { milkVolume: milkVolumeL }
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

    res.json({
        batchId: batch.id,
        currentStageId: batch.currentStageId,
        status: batch.status,
        activeTimers: timersWithStatus,
        nextAction: stage?.instructions?.[0] || stage?.name || "Proceed",
        guidance: stage?.llm_guidance
    });
  });

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
        phs.push({ value, timestamp, notes });
        measurements.ph = phs;
        // Also update latest ph_value for quick access
        measurements.ph_value = value; 
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

  app.post(api.batches.advance.path, async (req, res) => {
    const batchId = Number(req.params.id);
    const batch = await storage.getBatch(batchId);
    if (!batch) return res.status(404).json({ message: "Batch not found" });

    const currentStage = recipeManager.getStage(batch.currentStageId);
    if (!currentStage) return res.status(500).json({ message: "Invalid stage" });

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
        const completed = await storage.updateBatch(batchId, { status: "completed" });
        return res.json(completed);
    }

    // Clean up expired timers from current stage
    let activeTimers = (batch.activeTimers as any[]) || [];
    activeTimers = activeTimers.filter(t => t.stageId !== currentStage.id);

    // Handle new stage side-effects (e.g. start timers)
    const updates: any = {
        currentStageId: nextStage.id,
        activeTimers
    };

    if (nextStage.timer) {
        const durationMin = nextStage.timer.duration_min || 0;
        const durationHours = nextStage.timer.duration_hours || 0;
        const durationMs = durationMin * 60000 + durationHours * 3600000;
        if (durationMs > 0) {
            activeTimers.push({
                stageId: nextStage.id,
                startTime: new Date().toISOString(),
                endTime: new Date(Date.now() + durationMs).toISOString(),
                durationMinutes: durationMin + (durationHours * 60),
                blocking: nextStage.timer.blocking
            });
            updates.activeTimers = activeTimers;
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
  
  // Basic Seed
  const existingBatches = await storage.getActiveBatches();
  if (existingBatches.length === 0) {
      console.log("Seeding initial batch...");
      // Add a test batch
  }

  return httpServer;
}
