import { db } from "./db";
import { alexaWebhookLogs, webRequestLogs } from "@shared/schema";
import { lt, desc, eq, and, gte, lte, like, sql } from "drizzle-orm";

export async function logAlexaWebhook(data: {
  alexaUserId?: string;
  intentName?: string;
  stageId?: number;
  batchId?: number;
  requestType?: string;
  slots?: Record<string, any>;
  sessionAttributes?: Record<string, any>;
  responseSpeech?: string;
  durationMs?: number;
  error?: string;
}) {
  try {
    await db.insert(alexaWebhookLogs).values({
      alexaUserId: data.alexaUserId || null,
      intentName: data.intentName || null,
      stageId: data.stageId || null,
      batchId: data.batchId || null,
      requestType: data.requestType || null,
      slots: data.slots || {},
      sessionAttributes: data.sessionAttributes || {},
      responseSpeech: data.responseSpeech ? data.responseSpeech.substring(0, 2000) : null,
      durationMs: data.durationMs || null,
      error: data.error || null,
    });
  } catch (err) {
    console.error("[logService] Error inserting alexa webhook log:", err);
  }
}

export async function logWebRequest(data: {
  method: string;
  path: string;
  statusCode?: number;
  durationMs?: number;
  requestBody?: Record<string, any>;
  responseBody?: Record<string, any>;
  error?: string;
}) {
  try {
    const sanitizedReqBody = data.requestBody ? JSON.parse(JSON.stringify(data.requestBody)) : {};
    const sanitizedResBody = data.responseBody ? truncateJson(data.responseBody, 2000) : {};
    
    await db.insert(webRequestLogs).values({
      method: data.method,
      path: data.path,
      statusCode: data.statusCode || null,
      durationMs: data.durationMs || null,
      requestBody: sanitizedReqBody,
      responseBody: sanitizedResBody,
      error: data.error || null,
    });
  } catch (err) {
    console.error("[logService] Error inserting web request log:", err);
  }
}

function truncateJson(obj: any, maxLength: number): any {
  const str = JSON.stringify(obj);
  if (str.length <= maxLength) return obj;
  return { _truncated: true, preview: str.substring(0, maxLength) };
}

export async function purgeOldLogs(): Promise<{ alexaDeleted: number; webDeleted: number }> {
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  
  const alexaResult = await db.delete(alexaWebhookLogs)
    .where(lt(alexaWebhookLogs.timestamp, cutoff));
  
  const webResult = await db.delete(webRequestLogs)
    .where(lt(webRequestLogs.timestamp, cutoff));
  
  const alexaDeleted = (alexaResult as any).rowCount || 0;
  const webDeleted = (webResult as any).rowCount || 0;
  
  console.log(`[logService] Purge complete: ${alexaDeleted} alexa logs, ${webDeleted} web logs deleted (cutoff: ${cutoff.toISOString()})`);
  return { alexaDeleted, webDeleted };
}

export function scheduleDailyPurge() {
  const BRT_OFFSET_MS = -3 * 60 * 60 * 1000;
  
  function msUntilNext3amBRT(): number {
    const now = new Date();
    const nowBRT = new Date(now.getTime() + BRT_OFFSET_MS);
    
    const target = new Date(nowBRT);
    target.setHours(3, 0, 0, 0);
    
    if (target.getTime() <= nowBRT.getTime()) {
      target.setDate(target.getDate() + 1);
    }
    
    const targetUTC = new Date(target.getTime() - BRT_OFFSET_MS);
    return targetUTC.getTime() - now.getTime();
  }

  function scheduleNext() {
    const delay = msUntilNext3amBRT();
    const nextRun = new Date(Date.now() + delay);
    console.log(`[logService] Next log purge scheduled for ${nextRun.toISOString()} (3:00 AM BRT)`);
    
    setTimeout(async () => {
      try {
        await purgeOldLogs();
      } catch (err) {
        console.error("[logService] Purge failed:", err);
      }
      scheduleNext();
    }, delay);
  }
  
  scheduleNext();
}

export async function queryAlexaLogs(filters: {
  batchId?: number;
  intentName?: string;
  startDate?: string;
  endDate?: string;
  limit?: number;
  offset?: number;
}) {
  const conditions = [];
  
  if (filters.batchId) {
    conditions.push(eq(alexaWebhookLogs.batchId, filters.batchId));
  }
  if (filters.intentName) {
    conditions.push(like(alexaWebhookLogs.intentName, `%${filters.intentName}%`));
  }
  if (filters.startDate) {
    conditions.push(gte(alexaWebhookLogs.timestamp, new Date(filters.startDate)));
  }
  if (filters.endDate) {
    conditions.push(lte(alexaWebhookLogs.timestamp, new Date(filters.endDate)));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
  const limit = Math.min(filters.limit || 50, 200);
  const offset = filters.offset || 0;

  const [logs, countResult] = await Promise.all([
    db.select().from(alexaWebhookLogs)
      .where(whereClause)
      .orderBy(desc(alexaWebhookLogs.timestamp))
      .limit(limit)
      .offset(offset),
    db.select({ count: sql<number>`count(*)` }).from(alexaWebhookLogs).where(whereClause),
  ]);

  return { logs, total: Number(countResult[0]?.count || 0), limit, offset };
}

export async function queryWebLogs(filters: {
  method?: string;
  path?: string;
  startDate?: string;
  endDate?: string;
  limit?: number;
  offset?: number;
}) {
  const conditions = [];
  
  if (filters.method) {
    conditions.push(eq(webRequestLogs.method, filters.method.toUpperCase()));
  }
  if (filters.path) {
    conditions.push(like(webRequestLogs.path, `%${filters.path}%`));
  }
  if (filters.startDate) {
    conditions.push(gte(webRequestLogs.timestamp, new Date(filters.startDate)));
  }
  if (filters.endDate) {
    conditions.push(lte(webRequestLogs.timestamp, new Date(filters.endDate)));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
  const limit = Math.min(filters.limit || 50, 200);
  const offset = filters.offset || 0;

  const [logs, countResult] = await Promise.all([
    db.select().from(webRequestLogs)
      .where(whereClause)
      .orderBy(desc(webRequestLogs.timestamp))
      .limit(limit)
      .offset(offset),
    db.select({ count: sql<number>`count(*)` }).from(webRequestLogs).where(whereClause),
  ]);

  return { logs, total: Number(countResult[0]?.count || 0), limit, offset };
}
