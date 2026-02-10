import { recipeManager, getWaitSpecForStage } from './recipe.js';

export interface ApiContext {
  apiEndpoint: string;
  apiAccessToken: string;
}

export interface ScheduledAlert {
  reminderId: string;
  stageId: number;
  dueAtISO: string;
  kind: string;
}

export interface ReminderResult {
  reminderId: string | null;
  permissionDenied: boolean;
  httpStatus?: number;
}

export function getApiContext(alexaRequest: any): ApiContext | null {
  const system = alexaRequest?.context?.System;
  const apiEndpoint = system?.apiEndpoint;
  const apiAccessToken = system?.apiAccessToken;
  if (!apiEndpoint || !apiAccessToken) {
    console.log(`[REMINDER] getApiContext: apiEndpoint=${apiEndpoint ? 'present' : 'missing'} apiAccessToken=${apiAccessToken ? `present(${String(apiAccessToken).substring(0, 10)}...)` : 'missing'}`);
    return null;
  }
  console.log(`[REMINDER] getApiContext: endpoint=${apiEndpoint} token=${String(apiAccessToken).substring(0, 10)}...`);
  return { apiEndpoint: apiEndpoint.replace(/\/$/, ''), apiAccessToken };
}

function toLocalISOString(date: Date, tz: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).formatToParts(date);

    const get = (type: string) => parts.find(p => p.type === type)?.value || '00';
    return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}.000`;
  } catch {
    const iso = date.toISOString();
    return iso.replace('Z', '').replace(/\.\d{3}$/, '.000');
  }
}

export async function scheduleReminderForWait(
  apiCtx: ApiContext,
  batch: { id: number; recipeId: string },
  stageId: number,
  seconds: number,
  timezone?: string
): Promise<ReminderResult> {
  const stage = recipeManager.getStage(stageId);
  const recipeName = recipeManager.getRecipeName();
  const stageName = stage?.name || `Etapa ${stageId}`;
  const tz = timezone || 'America/Sao_Paulo';

  const now = new Date();
  const scheduledDate = new Date(now.getTime() + seconds * 1000);
  const requestTime = toLocalISOString(now, tz);
  const scheduledTime = toLocalISOString(scheduledDate, tz);

  const body = {
    requestTime,
    trigger: {
      type: 'SCHEDULED_ABSOLUTE',
      scheduledTime,
      timeZoneId: tz,
    },
    alertInfo: {
      spokenInfo: {
        content: [
          {
            locale: 'pt-BR',
            text: `Tempo finalizado do lote ${recipeName}. Etapa ${stageId}: ${stageName}. Você já pode continuar.`,
          },
        ],
      },
    },
    pushNotification: {
      status: 'ENABLED',
    },
  };

  try {
    const url = `${apiCtx.apiEndpoint}/v1/alerts/reminders`;
    console.log(`[REMINDER] Scheduling for batch=${batch.id} stage=${stageId} seconds=${seconds} scheduledTime=${scheduledTime} tz=${tz}`);
    console.log(`[REMINDER] Request body: ${JSON.stringify(body)}`);

    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiCtx.apiAccessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const respText = await resp.text();
    console.log(`[REMINDER] Response status=${resp.status} body=${respText}`);

    if (!resp.ok) {
      console.error(`[REMINDER] API error ${resp.status}: ${respText}`);
      const permissionDenied = resp.status === 401 || resp.status === 403;
      if (permissionDenied) {
        console.error(`[REMINDER] Permission denied (${resp.status}). User needs to grant alexa::alerts:reminders:skill:readwrite permission.`);
      }
      return { reminderId: null, permissionDenied, httpStatus: resp.status };
    }

    let data: { alertToken?: string };
    try {
      data = JSON.parse(respText);
    } catch {
      console.error(`[REMINDER] Failed to parse response as JSON: ${respText}`);
      return { reminderId: null, permissionDenied: false };
    }

    const reminderId = data.alertToken || null;
    console.log(`[REMINDER] Created reminderId=${reminderId} for batch=${batch.id} stage=${stageId}`);
    return { reminderId, permissionDenied: false };
  } catch (err) {
    console.error(`[REMINDER] Failed to schedule:`, err);
    return { reminderId: null, permissionDenied: false };
  }
}

export async function cancelReminder(
  apiCtx: ApiContext,
  reminderId: string
): Promise<void> {
  try {
    const url = `${apiCtx.apiEndpoint}/v1/alerts/reminders/${reminderId}`;
    console.log(`[REMINDER] Cancelling reminderId=${reminderId}`);

    const resp = await fetch(url, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${apiCtx.apiAccessToken}`,
      },
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.error(`[REMINDER] Cancel error ${resp.status}: ${errText}`);
    } else {
      console.log(`[REMINDER] Cancelled reminderId=${reminderId}`);
    }
  } catch (err) {
    console.error(`[REMINDER] Cancel failed:`, err);
  }
}

export async function cancelAllBatchReminders(
  apiCtx: ApiContext,
  scheduledAlerts: Record<string, ScheduledAlert>
): Promise<void> {
  const keys = Object.keys(scheduledAlerts || {});
  if (keys.length === 0) return;

  console.log(`[REMINDER] Cancelling ${keys.length} reminder(s) for batch`);
  await Promise.all(
    keys.map(key => {
      const alert = scheduledAlerts[key];
      if (alert?.reminderId) {
        return cancelReminder(apiCtx, alert.reminderId);
      }
      return Promise.resolve();
    })
  );
}

export function buildPermissionCard(): { card: any; speechHint: string } {
  return {
    card: {
      type: 'AskForPermissionsConsent',
      permissions: ['alexa::alerts:reminders:skill:readwrite'],
    },
    speechHint:
      'Para eu te avisar automaticamente quando o tempo acabar, habilite as permissões de lembrete no app da Alexa.',
  };
}
