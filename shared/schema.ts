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
  status: text("status", { enum: ["active", "paused", "completed", "cancelled"] }).notNull().default("active"),
  
  // JSONB storage for complex state
  calculatedInputs: jsonb("calculated_inputs").default({}),
  measurements: jsonb("measurements").default({}), // ph, temps, timestamps
  activeTimers: jsonb("active_timers").default([]),
  activeReminders: jsonb("active_reminders").default([]), // For recurring reminders (stage 15, 20)
  history: jsonb("history").default([]), // Log of all actions
  
  // Operational state
  pausedAt: timestamp("paused_at"),
  pauseReason: text("pause_reason"),
  cancelledAt: timestamp("cancelled_at"),
  cancelReason: text("cancel_reason"),
  completedAt: timestamp("completed_at"),
  
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
  updatedAt: true
});

export const insertLogSchema = createInsertSchema(batchLogs).omit({ 
  id: true, 
  timestamp: true 
});

// === CHEESE TYPES ===

export const CHEESE_TYPES = {
  QUEIJO_NETE: {
    id: "QUEIJO_NETE",
    name: "Nete",
    description: "Queijo artesanal tradicional da Matuh",
    available: true
  },
  QUEIJO_NINA: {
    id: "QUEIJO_NINA",
    name: "Nina",
    description: "Queijo maturado especial",
    available: false
  },
  QUEIJO_LALA: {
    id: "QUEIJO_LALA",
    name: "Lala",
    description: "Queijo fresco suave",
    available: false
  }
} as const;

export type CheeseTypeId = keyof typeof CHEESE_TYPES;
export type CheeseType = typeof CHEESE_TYPES[CheeseTypeId];

export function getCheeseTypeName(recipeId: string): string {
  const cheese = Object.values(CHEESE_TYPES).find(c => c.id === recipeId);
  return cheese?.name || recipeId.replace("QUEIJO_", "");
}

export function getAvailableCheeseTypes(): CheeseType[] {
  return Object.values(CHEESE_TYPES).filter(c => c.available);
}

export function getAllCheeseTypes(): CheeseType[] {
  return Object.values(CHEESE_TYPES);
}

// === EXPLICIT API CONTRACT TYPES ===

// Batch Types
export type ProductionBatch = typeof productionBatches.$inferSelect;
export type InsertBatch = z.infer<typeof insertBatchSchema>;

// Request Types
export type StartBatchRequest = {
  milkVolumeL: number;
  recipeId?: string; // Cheese type ID (defaults to QUEIJO_NETE)
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

// Canonical input request (new format aligned with YAML)
export type CanonicalInputRequest = {
  key: string; // e.g., milk_volume_l, flocculation_time, ph_value
  value: number | string;
  unit?: string;
  notes?: string;
};

// Operational state requests
export type PauseBatchRequest = {
  reason?: string;
};

export type CancelBatchRequest = {
  reason: string;
};

// Timer/Reminder types
export type TimerInfo = {
  stageId: number;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  blocking: boolean;
  isComplete: boolean;
  remainingSeconds: number;
};

export type ReminderInfo = {
  id: string;
  stageId: number;
  type: "interval" | "daily";
  intervalHours?: number;
  nextTrigger: string;
  acknowledged: boolean;
  description: string;
};

// Stage detail response
export type StageDetailResponse = {
  stageId: number;
  name: string;
  type: string;
  instructions?: string[];
  requiredInputs?: string[];
  storedValues?: string[];
  validations?: Array<{ rule: string }>;
  timer?: {
    durationMin?: number;
    durationHours?: number;
    blocking?: boolean;
    intervalHours?: number;
  };
  reminder?: {
    frequency: string;
  };
  loopCondition?: {
    until: string;
  };
  llmGuidance?: string;
};

// Recipe metadata
export type RecipeSummary = {
  recipeId: string;
  name: string;
  schemaVersion: string;
  stageCount: number;
};

export type RecipeDetail = RecipeSummary & {
  description?: string;
  stages: StageDetailResponse[];
  inputs: Array<{
    id: string;
    name: string;
    unit: string;
    dosing?: {
      mode: string;
      value: number;
    };
  }>;
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
