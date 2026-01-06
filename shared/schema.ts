import { pgTable, text, serial, integer, boolean, timestamp, jsonb, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { relations } from "drizzle-orm";

// === TABLE DEFINITIONS ===

export const productionBatches = pgTable("production_batches", {
  id: serial("id").primaryKey(),
  recipeId: text("recipe_id").notNull(),
  currentStageId: integer("current_stage_id").notNull().default(1),
  milkVolumeL: numeric("milk_volume_l").notNull(),
  status: text("status", { enum: ["active", "paused", "completed"] }).notNull().default("active"),
  
  // JSONB storage for complex state
  calculatedInputs: jsonb("calculated_inputs").default({}),
  measurements: jsonb("measurements").default({}), // ph, temps, timestamps
  activeTimers: jsonb("active_timers").default([]),
  history: jsonb("history").default([]), // Log of all actions
  
  startedAt: timestamp("started_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const batchLogs = pgTable("batch_logs", {
  id: serial("id").primaryKey(),
  batchId: integer("batch_id").notNull().references(() => productionBatches.id),
  stageId: integer("stage_id").notNull(),
  action: text("action").notNull(), // 'start', 'complete', 'input', 'alert'
  details: jsonb("details").default({}),
  timestamp: timestamp("timestamp").defaultNow().notNull(),
});

// === RELATIONS ===
export const batchRelations = relations(productionBatches, ({ many }) => ({
  logs: many(batchLogs),
}));

export const logRelations = relations(batchLogs, ({ one }) => ({
  batch: one(productionBatches, {
    fields: [batchLogs.batchId],
    references: [productionBatches.id],
  }),
}));

// === BASE SCHEMAS ===
export const insertBatchSchema = createInsertSchema(productionBatches).omit({ 
  id: true, 
  startedAt: true, 
  updatedAt: true,
  calculatedInputs: true,
  measurements: true,
  activeTimers: true,
  history: true
});

export const insertLogSchema = createInsertSchema(batchLogs).omit({ 
  id: true, 
  timestamp: true 
});

// === EXPLICIT API CONTRACT TYPES ===

// Batch Types
export type ProductionBatch = typeof productionBatches.$inferSelect;
export type InsertBatch = z.infer<typeof insertBatchSchema>;

// Request Types
export type StartBatchRequest = {
  milkVolumeL: number;
};

export type AdvanceStageRequest = {
  stageId: number; // Verification that client knows where it is
  inputs?: Record<string, any>; // Optional inputs if stage requires them
};

export type LogMeasurementRequest = {
  type: "ph" | "temperature" | "time";
  value: number | string;
  notes?: string;
};

// Response Types
export type BatchResponse = ProductionBatch & {
  recipeName?: string;
  currentStageName?: string;
  nextAction?: string;
};

export type BatchStatusResponse = {
  batchId: number;
  currentStageId: number;
  status: string;
  activeTimers: any[];
  nextAction: string;
  guidance?: string; // LLM guidance
};

// Re-export chat types
export * from "./models/chat";
