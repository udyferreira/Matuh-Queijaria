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

export function getApiContext(alexaRequest: any): ApiContext | null {
  const system = alexaRequest?.context?.System;
  const apiEndpoint = system?.apiEndpoint;
  const apiAccessToken = system?.apiAccessToken;
  if (!apiEndpoint || !apiAccessToken) return null;
  return { apiEndpoint: apiEndpoint.replace(/\/$/, ''), apiAccessToken };
}

export async function scheduleReminderForWait(
  apiCtx: ApiContext,
  batch: { id: number; recipeId: string },
  stageId: number,
  seconds: number,
  timezone?: string
): Promise<string | null> {
  const stage = recipeManager.getStage(stageId);
  const recipeName = recipeManager.getRecipeName();
  const stageName = stage?.name || `Etapa ${stageId}`;
  const tz = timezone || 'America/Sao_Paulo';

  const scheduledTime = new Date(Date.now() + seconds * 1000).toISOString();

  const body = {
    requestTime: new Date().toISOString(),
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
    console.log(`[REMINDER] Scheduling for batch=${batch.id} stage=${stageId} seconds=${seconds}`);

    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiCtx.apiAccessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.error(`[REMINDER] API error ${resp.status}: ${errText}`);
      return null;
    }

    const data = await resp.json() as { alertToken?: string };
    const reminderId = data.alertToken || null;
    console.log(`[REMINDER] Created reminderId=${reminderId} for batch=${batch.id} stage=${stageId}`);
    return reminderId;
  } catch (err) {
    console.error(`[REMINDER] Failed to schedule:`, err);
    return null;
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
