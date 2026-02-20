import { db } from "./db";
import { 
  productionBatches, batchLogs, alexaUserState,
  type ProductionBatch, type InsertBatch,
  type InsertLog 
} from "@shared/schema";
import { eq, desc, inArray } from "drizzle-orm";
import { chatStorage, type IChatStorage } from "./replit_integrations/chat/storage";

export interface IStorage extends IChatStorage {
  // Batch Operations
  getBatch(id: number): Promise<ProductionBatch | undefined>;
  getActiveBatches(): Promise<ProductionBatch[]>;
  getCompletedBatches(): Promise<ProductionBatch[]>;
  getAllBatches(): Promise<ProductionBatch[]>;
  createBatch(batch: InsertBatch): Promise<ProductionBatch>;
  updateBatch(id: number, updates: Partial<ProductionBatch>): Promise<ProductionBatch>;
  
  // Logging
  logBatchAction(log: InsertLog): Promise<void>;
  getBatchLogs(batchId: number): Promise<any[]>;

  // Alexa User State
  getLastActiveBatch(alexaUserId: string): Promise<number | null>;
  setLastActiveBatch(alexaUserId: string, batchId: number): Promise<void>;
  clearLastActiveBatch(alexaUserId: string): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  // --- Chat Storage Mixin ---
  getConversation = chatStorage.getConversation;
  getAllConversations = chatStorage.getAllConversations;
  createConversation = chatStorage.createConversation;
  deleteConversation = chatStorage.deleteConversation;
  getMessagesByConversation = chatStorage.getMessagesByConversation;
  createMessage = chatStorage.createMessage;

  // --- Batch Operations ---
  async getBatch(id: number): Promise<ProductionBatch | undefined> {
    const [batch] = await db.select().from(productionBatches).where(eq(productionBatches.id, id));
    return batch;
  }

  async getActiveBatches(): Promise<ProductionBatch[]> {
    return await db.select()
      .from(productionBatches)
      .where(inArray(productionBatches.status, ["active", "in_progress"] as any))
      .orderBy(desc(productionBatches.startedAt));
  }

  async getCompletedBatches(): Promise<ProductionBatch[]> {
    return await db.select()
      .from(productionBatches)
      .where(eq(productionBatches.status, "completed"))
      .orderBy(desc(productionBatches.completedAt));
  }

  async getAllBatches(): Promise<ProductionBatch[]> {
    return await db.select()
      .from(productionBatches)
      .orderBy(desc(productionBatches.startedAt));
  }

  async createBatch(batch: InsertBatch): Promise<ProductionBatch> {
    const [newBatch] = await db.insert(productionBatches).values(batch).returning();
    return newBatch;
  }

  async createBatchRaw(data: any): Promise<ProductionBatch> {
    const [newBatch] = await db.insert(productionBatches).values({
      recipeId: data.recipe_id,
      currentStageId: data.current_stage_id,
      milkVolumeL: String(data.milk_volume_l),
      status: data.status,
      calculatedInputs: data.calculated_inputs,
      measurements: data.measurements,
      activeTimers: data.active_timers,
      history: data.history,
      startedAt: data.started_at ? new Date(data.started_at) : new Date(),
      updatedAt: data.updated_at ? new Date(data.updated_at) : new Date(),
      activeReminders: data.active_reminders,
      pausedAt: data.paused_at ? new Date(data.paused_at) : null,
      pauseReason: data.pause_reason,
      cancelledAt: data.cancelled_at ? new Date(data.cancelled_at) : null,
      cancelReason: data.cancel_reason,
      completedAt: data.completed_at ? new Date(data.completed_at) : null,
      batchStatus: data.batch_status,
      turningCyclesCount: data.turning_cycles_count ?? 0,
      chamber2EntryDate: data.chamber_2_entry_date ? new Date(data.chamber_2_entry_date) : null,
      maturationEndDate: data.maturation_end_date ? new Date(data.maturation_end_date) : null,
      scheduledAlerts: data.scheduled_alerts,
    }).returning();
    return newBatch;
  }

  async updateBatch(id: number, updates: Partial<ProductionBatch>): Promise<ProductionBatch> {
    const [updated] = await db.update(productionBatches)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(productionBatches.id, id))
      .returning();
    return updated;
  }

  // --- Logging ---
  async logBatchAction(log: InsertLog): Promise<void> {
    await db.insert(batchLogs).values(log);
  }

  async getBatchLogs(batchId: number): Promise<any[]> {
    return await db.select()
      .from(batchLogs)
      .where(eq(batchLogs.batchId, batchId))
      .orderBy(desc(batchLogs.timestamp));
  }

  async getLastActiveBatch(alexaUserId: string): Promise<number | null> {
    const [row] = await db.select()
      .from(alexaUserState)
      .where(eq(alexaUserState.alexaUserId, alexaUserId));
    return row?.activeBatchId ?? null;
  }

  async setLastActiveBatch(alexaUserId: string, batchId: number): Promise<void> {
    await db.insert(alexaUserState)
      .values({ alexaUserId, activeBatchId: batchId, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: alexaUserState.alexaUserId,
        set: { activeBatchId: batchId, updatedAt: new Date() },
      });
  }

  async clearLastActiveBatch(alexaUserId: string): Promise<void> {
    await db.delete(alexaUserState)
      .where(eq(alexaUserState.alexaUserId, alexaUserId));
  }
}

export const storage = new DatabaseStorage();
