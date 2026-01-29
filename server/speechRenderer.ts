/**
 * Speech Renderer - LLM-based speech generation for Alexa responses
 * 
 * The LLM's ONLY responsibility is to transform structured JSON into natural speech.
 * It NEVER decides rules, validates, calculates, or invents data.
 * All decisions are made by the backend before calling this module.
 */

import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

export type SpeechContext = 
  | "status" 
  | "instructions" 
  | "advance" 
  | "help" 
  | "query_input" 
  | "error" 
  | "start_batch"
  | "log_time"
  | "log_ph"
  | "log_date";

export interface DoseInfo {
  value: number;
  unit: string;
}

export interface TimerInfo {
  description: string;
  blocking: boolean;
  remainingMinutes?: number;
}

export interface SpeechRenderPayload {
  context: SpeechContext;
  stage?: {
    id: number;
    name: string;
  };
  instructions?: string[];
  doses?: Record<string, DoseInfo>;
  timers?: TimerInfo[];
  allowedUtterances?: string[];
  notes?: string;
  errorMessage?: string;
  queryResult?: {
    inputType: string;
    value: number;
    unit: string;
  };
  batchInfo?: {
    milkVolumeL: number;
    startedAt?: string;
  };
  loggedValue?: {
    type: string;
    value: string | number;
  };
}

const SPEECH_RENDERER_PROMPT = `Sua função é APENAS narrar uma resposta de voz para Alexa, em português do Brasil.
Você receberá um JSON estruturado.
Use SOMENTE as informações fornecidas.
Não crie novos comandos.
Não invente dados.
Não seja criativo.
Não explique regras internas.

Regras de fala:
- Se houver stage, diga "Etapa X: [nome]" no início.
- Diga as instructions de forma clara e sequencial.
- Se houver doses, diga todas com valor e unidade (ex: "65 ml de fermento LR").
- Se houver timers, mencione-os brevemente.
- Se houver notes (restrições), diga explicitamente.
- Se houver allowedUtterances, sugira no máximo 2 exemplos EXATAMENTE como fornecidos.
- Para query_input, diga "A quantidade de [tipo] é [valor] [unidade]."
- Para errors, diga a mensagem de erro de forma clara.
- Para log_time/log_ph/log_date, confirme o registro feito.
- Use frases curtas, com pontuação correta.
- Máximo de 3-4 frases no total.

Responda APENAS com o texto de fala, sem aspas, sem explicações.`;

/**
 * Render structured data into natural speech using LLM
 */
export async function renderSpeech(payload: SpeechRenderPayload): Promise<string> {
  const payloadJson = JSON.stringify(payload, null, 2);
  
  console.log(`[llm.render.input] context=${payload.context} stage=${payload.stage?.id || 'N/A'} payload=${payloadJson}`);
  
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: SPEECH_RENDERER_PROMPT },
        { role: "user", content: payloadJson }
      ],
      temperature: 0.3,
      max_tokens: 300,
    });
    
    const speech = response.choices[0]?.message?.content?.trim() || getFallbackSpeech(payload);
    
    console.log(`[llm.render.output] "${speech}"`);
    
    return speech;
  } catch (error) {
    console.error("[llm.render.error]", error);
    return getFallbackSpeech(payload);
  }
}

/**
 * Fallback speech generation when LLM fails
 * Uses simple deterministic logic
 */
function getFallbackSpeech(payload: SpeechRenderPayload): string {
  const parts: string[] = [];
  
  if (payload.stage) {
    parts.push(`Etapa ${payload.stage.id}: ${payload.stage.name}.`);
  }
  
  if (payload.errorMessage) {
    parts.push(payload.errorMessage);
  }
  
  if (payload.queryResult) {
    parts.push(`A quantidade de ${payload.queryResult.inputType} é ${payload.queryResult.value} ${payload.queryResult.unit}.`);
  }
  
  if (payload.doses) {
    const doseTexts = Object.entries(payload.doses)
      .map(([name, info]) => `${info.value} ${info.unit} de ${formatDoseName(name)}`)
      .join(', ');
    if (doseTexts) parts.push(`Use ${doseTexts}.`);
  }
  
  if (payload.instructions && payload.instructions.length > 0) {
    parts.push(payload.instructions.slice(0, 2).join(' '));
  }
  
  if (payload.allowedUtterances && payload.allowedUtterances.length > 0) {
    const examples = payload.allowedUtterances.slice(0, 2).join(' ou ');
    parts.push(`Você pode dizer: ${examples}.`);
  }
  
  return parts.join(' ') || "Não foi possível processar sua solicitação.";
}

function formatDoseName(name: string): string {
  const nameMap: Record<string, string> = {
    "FERMENT_LR": "fermento LR",
    "FERMENT_DX": "fermento DX", 
    "FERMENT_KL": "fermento KL",
    "RENNET": "coalho",
    "SALT": "sal"
  };
  return nameMap[name] || name;
}

/**
 * Build a SpeechRenderPayload for status/instructions context
 */
export function buildStatusPayload(
  batch: any,
  stage: any,
  context: "status" | "instructions" = "status"
): SpeechRenderPayload {
  const calculatedInputs = batch.calculatedInputs || {};
  const doses: Record<string, DoseInfo> = {};
  
  // Add doses relevant to current stage
  if (stage.id === 3 && calculatedInputs.FERMENT_KL) {
    doses["FERMENT_KL"] = { value: calculatedInputs.FERMENT_KL, unit: "ml" };
  }
  if (stage.id === 4) {
    if (calculatedInputs.FERMENT_LR) doses["FERMENT_LR"] = { value: calculatedInputs.FERMENT_LR, unit: "ml" };
    if (calculatedInputs.FERMENT_DX) doses["FERMENT_DX"] = { value: calculatedInputs.FERMENT_DX, unit: "ml" };
  }
  if (stage.id === 5 && calculatedInputs.RENNET) {
    doses["RENNET"] = { value: calculatedInputs.RENNET, unit: "ml" };
  }
  
  const timers: TimerInfo[] = [];
  const activeTimers = batch.activeTimers || [];
  for (const timer of activeTimers) {
    const remaining = timer.endTime ? Math.max(0, Math.ceil((new Date(timer.endTime).getTime() - Date.now()) / 60000)) : 0;
    timers.push({
      description: timer.description || `Timer de ${timer.durationMinutes} minutos`,
      blocking: timer.blocking || false,
      remainingMinutes: remaining
    });
  }
  
  return {
    context,
    stage: {
      id: stage.id,
      name: stage.name
    },
    instructions: stage.instructions || [],
    doses: Object.keys(doses).length > 0 ? doses : undefined,
    timers: timers.length > 0 ? timers : undefined,
    allowedUtterances: getContextualUtterances(stage, batch)
  };
}

/**
 * Build a SpeechRenderPayload for advance context
 */
export function buildAdvancePayload(
  batch: any,
  nextStage: any,
  completed: boolean = false
): SpeechRenderPayload {
  if (completed) {
    return {
      context: "advance",
      notes: "Lote finalizado com sucesso! Todas as 20 etapas foram concluídas.",
      allowedUtterances: ["qual é o status", "iniciar novo lote"]
    };
  }
  
  const calculatedInputs = batch.calculatedInputs || {};
  const doses: Record<string, DoseInfo> = {};
  
  if (nextStage.id === 3 && calculatedInputs.FERMENT_KL) {
    doses["FERMENT_KL"] = { value: calculatedInputs.FERMENT_KL, unit: "ml" };
  }
  if (nextStage.id === 4) {
    if (calculatedInputs.FERMENT_LR) doses["FERMENT_LR"] = { value: calculatedInputs.FERMENT_LR, unit: "ml" };
    if (calculatedInputs.FERMENT_DX) doses["FERMENT_DX"] = { value: calculatedInputs.FERMENT_DX, unit: "ml" };
  }
  if (nextStage.id === 5 && calculatedInputs.RENNET) {
    doses["RENNET"] = { value: calculatedInputs.RENNET, unit: "ml" };
  }
  
  const timers: TimerInfo[] = [];
  if (nextStage.timer) {
    const durationMinutes = nextStage.timer.duration_minutes || (nextStage.timer.duration_hours * 60);
    timers.push({
      description: `${durationMinutes} minutos`,
      blocking: nextStage.timer.blocking || false
    });
  }
  
  return {
    context: "advance",
    stage: {
      id: nextStage.id,
      name: nextStage.name
    },
    instructions: nextStage.instructions || [],
    doses: Object.keys(doses).length > 0 ? doses : undefined,
    timers: timers.length > 0 ? timers : undefined,
    allowedUtterances: getContextualUtterances(nextStage, batch)
  };
}

/**
 * Build a SpeechRenderPayload for query_input context
 */
export function buildQueryInputPayload(
  inputType: string,
  value: number
): SpeechRenderPayload {
  // All ferment/rennet quantities are in ml
  const unit = "ml";
  
  return {
    context: "query_input",
    queryResult: {
      inputType: formatDoseName(inputType),
      value,
      unit
    }
  };
}

/**
 * Build a SpeechRenderPayload for help context
 */
export function buildHelpPayload(
  stage?: any,
  batch?: any
): SpeechRenderPayload {
  const utterances = stage && batch 
    ? getContextualUtterances(stage, batch)
    : ["qual é o status", "diga instruções", "avançar etapa"];
  
  return {
    context: "help",
    stage: stage ? { id: stage.id, name: stage.name } : undefined,
    allowedUtterances: utterances
  };
}

/**
 * Build a SpeechRenderPayload for error context
 */
export function buildErrorPayload(
  errorMessage: string,
  stage?: any
): SpeechRenderPayload {
  return {
    context: "error",
    errorMessage,
    stage: stage ? { id: stage.id, name: stage.name } : undefined
  };
}

/**
 * Build a SpeechRenderPayload for start_batch context
 */
export function buildStartBatchPayload(
  batch: any,
  firstStage: any
): SpeechRenderPayload {
  const calculatedInputs = batch.calculatedInputs || {};
  
  const doses: Record<string, DoseInfo> = {};
  if (calculatedInputs.FERMENT_LR) doses["FERMENT_LR"] = { value: calculatedInputs.FERMENT_LR, unit: "ml" };
  if (calculatedInputs.FERMENT_DX) doses["FERMENT_DX"] = { value: calculatedInputs.FERMENT_DX, unit: "ml" };
  if (calculatedInputs.FERMENT_KL) doses["FERMENT_KL"] = { value: calculatedInputs.FERMENT_KL, unit: "ml" };
  if (calculatedInputs.RENNET) doses["RENNET"] = { value: calculatedInputs.RENNET, unit: "ml" };
  
  return {
    context: "start_batch",
    batchInfo: {
      milkVolumeL: batch.milkVolumeL,
      startedAt: batch.startedAt
    },
    stage: {
      id: firstStage.id,
      name: firstStage.name
    },
    instructions: firstStage.instructions || [],
    doses,
    allowedUtterances: ["qual é o status", "avançar etapa", "diga instruções"]
  };
}

/**
 * Build a SpeechRenderPayload for launch/welcome context
 */
export function buildLaunchPayload(): SpeechRenderPayload {
  return {
    context: "help",
    notes: "Bem-vindo à Matuh Queijaria!",
    allowedUtterances: ["qual é o status", "iniciar novo lote com 130 litros, temperatura 32 graus, pH 6 ponto 5"]
  };
}

/**
 * Build a SpeechRenderPayload for logged value confirmation
 */
export function buildLogConfirmationPayload(
  logType: string,
  value: string | number,
  additionalInfo?: string
): SpeechRenderPayload {
  const typeLabels: Record<string, string> = {
    "flocculation_time": "horário de floculação",
    "cut_point_time": "horário do ponto de corte",
    "press_start_time": "horário de início da prensa",
    "ph_value": "pH",
    "initial_ph": "pH",
    "pieces_quantity": "quantidade de peças",
    "chamber_2_entry_date": "data de entrada na câmara 2"
  };
  
  return {
    context: logType.includes("time") ? "log_time" : 
             logType.includes("ph") ? "log_ph" : 
             logType.includes("date") ? "log_date" : "status",
    loggedValue: {
      type: typeLabels[logType] || logType,
      value
    },
    notes: additionalInfo
  };
}

/**
 * Get contextual utterances based on current stage and batch state
 */
function getContextualUtterances(stage: any, batch: any): string[] {
  const utterances: string[] = ["qual é o status", "diga instruções"];
  
  // Check for operator_input_required
  const requiredInputs = stage.operator_input_required || [];
  const storedValues = batch.storedValues || {};
  
  if (requiredInputs.includes("flocculation_time") && !storedValues.flocculation_time) {
    utterances.push("registrar horário de floculação");
  } else if (requiredInputs.includes("cut_point_time") && !storedValues.cut_point_time) {
    utterances.push("registrar horário de corte");
  } else if (requiredInputs.includes("press_start_time") && !storedValues.press_start_time) {
    utterances.push("registrar horário da prensa");
  } else if (requiredInputs.includes("initial_ph") && !storedValues.initial_ph) {
    utterances.push("registrar pH");
  } else if (requiredInputs.includes("chamber_2_entry_date") && !storedValues.chamber_2_entry_date) {
    utterances.push("registrar data de entrada na câmara");
  } else {
    utterances.push("avançar etapa");
  }
  
  return utterances;
}
