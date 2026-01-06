import { db } from "./db";
import { 
  productionBatches, batchLogs, 
  type ProductionBatch, type InsertBatch,
  type InsertLog 
} from "@shared/schema";
import { eq, desc } from "drizzle-orm";
import { chatStorage, type IChatStorage } from "./replit_integrations/chat/storage";

export interface IStorage extends IChatStorage {
  // Batch Operations
  getBatch(id: number): Promise<ProductionBatch | undefined>;
  getActiveBatches(): Promise<ProductionBatch[]>;
  createBatch(batch: InsertBatch): Promise<ProductionBatch>;
  updateBatch(id: number, updates: Partial<ProductionBatch>): Promise<ProductionBatch>;
  
  // Logging
  logBatchAction(log: InsertLog): Promise<void>;
  getBatchLogs(batchId: number): Promise<any[]>;
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
      .where(eq(productionBatches.status, "active"))
      .orderBy(desc(productionBatches.startedAt));
  }

  async createBatch(batch: InsertBatch): Promise<ProductionBatch> {
    const [newBatch] = await db.insert(productionBatches).values(batch).returning();
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
}

export const storage = new DatabaseStorage();
