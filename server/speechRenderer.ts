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
  | "auto_advance"
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
  confirmation?: string;
}

const SPEECH_RENDERER_PROMPT = `Sua função é APENAS narrar uma resposta de voz para Alexa, em português do Brasil.
Você receberá um JSON estruturado.
Use SOMENTE as informações fornecidas no JSON.
NUNCA invente dados, frases, pedidos ou instruções que não estejam no JSON.
NUNCA peça informações que não estão mencionadas no JSON.

Regras de fala:
- Se houver stage, diga "Etapa X: [nome]" no início.
- Se houver instructions, diga-as de forma clara e sequencial.
- Se instructions estiver vazio ou ausente, NÃO invente instruções.
- Se houver doses, diga todas com valor e unidade (ex: "65 ml de fermento LR").
- Se houver timers, mencione-os brevemente.
- Se houver notes, diga exatamente o que está em notes.
- Se notes estiver ausente ou vazio, NÃO invente notes.
- Se houver allowedUtterances, sugira 1-2 exemplos EXATAMENTE como fornecidos. Não substitua sinônimos.
- Nunca sugira exemplos de outra etapa.
- Para query_input, diga "A quantidade de [tipo] é [valor] [unidade]."
- Para errors, diga a mensagem de erro de forma clara.
- Para log_time/log_ph/log_date, confirme o registro feito.
- Para help sem notes, apenas diga o nome da etapa e sugira os allowedUtterances.
- Para auto_advance: primeiro diga "confirmation", depois "Etapa X: [nome]" e suas instruções. Combine numa narrativa fluida.
- Use frases curtas, máximo de 4 frases para auto_advance, 3 para outros.

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
      temperature: 0.0,
      max_tokens: 180,
    });
    
    let speech = response.choices[0]?.message?.content?.trim() || getFallbackSpeech(payload);
    
    // Validate LLM output - check for violations
    if (payload.allowedUtterances && payload.allowedUtterances.length > 0) {
      const violation = checkForViolation(speech, payload.allowedUtterances);
      if (violation) {
        console.log(`[llm.render.violation] LLM suggested "${violation}" which is not in allowedUtterances`);
        speech = getFallbackSpeech(payload);
      }
    }
    
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
  
  // For auto_advance context, include confirmation first
  if (payload.confirmation) {
    parts.push(payload.confirmation);
  }
  
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
 * Check if LLM output contains suggestions not in allowedUtterances or invented content
 * Returns the violating phrase if found, null otherwise
 */
function checkForViolation(speech: string, allowedUtterances: string[]): string | null {
  const speechLower = speech.toLowerCase();
  
  // Known invented content patterns - LLM making up requests
  const inventedPatterns = [
    /forneça.*notas/,
    /forneça.*instruções/,
    /preciso de.*informações/,
    /aguardando.*dados/,
  ];
  
  for (const pattern of inventedPatterns) {
    if (pattern.test(speechLower)) {
      const match = speechLower.match(pattern);
      return match ? match[0] : "invented content";
    }
  }
  
  // Known problematic patterns - suggestions from wrong stages
  const wrongStagePhrases = [
    { pattern: /hora da floculação/, validFor: ['floculação'] },
    { pattern: /hora do corte/, validFor: ['corte'] },
    { pattern: /hora da prensa/, validFor: ['prensa'] },
    { pattern: /registrar.*floculação/, validFor: ['floculação'] },
    { pattern: /registrar.*corte/, validFor: ['corte'] },
    { pattern: /registrar.*prensa/, validFor: ['prensa'] },
  ];
  
  // Check if any allowed utterance mentions floculação, corte, or prensa
  const allowedTopics = allowedUtterances.map(u => u.toLowerCase()).join(' ');
  
  for (const phrase of wrongStagePhrases) {
    if (phrase.pattern.test(speechLower)) {
      // Check if any of the valid topics is in allowed utterances
      const isValid = phrase.validFor.some(topic => allowedTopics.includes(topic));
      if (!isValid) {
        const match = speechLower.match(phrase.pattern);
        return match ? match[0] : null;
      }
    }
  }
  
  return null;
}

/**
 * Build a SpeechRenderPayload for status/instructions context
 */
export function buildStatusPayload(
  batch: any,
  stage: any,
  context: "status" | "instructions" = "status",
  pendingInputReminder?: string
): SpeechRenderPayload {
  const calculatedInputs = batch.calculatedInputs || {};
  
  // Use keyword-based dose matching instead of hardcoded stage IDs
  const doses = getRelevantDosesForStage(stage, calculatedInputs);
  
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
    allowedUtterances: getContextualUtterances(stage, batch),
    notes: pendingInputReminder
  };
}

/**
 * Build a SpeechRenderPayload for advance context
 * IMPORTANT: Never include NaN values in timers; if duration is undefined, omit timer
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
  
  // Use keyword-based dose matching instead of hardcoded stage IDs
  const doses = getRelevantDosesForStage(nextStage, calculatedInputs);
  
  // Build timers only if duration is valid (not undefined/NaN)
  const timers: TimerInfo[] = [];
  if (nextStage.timer) {
    const durationMinutes = nextStage.timer.duration_minutes;
    const durationHours = nextStage.timer.duration_hours;
    
    // Calculate total minutes only if we have valid values
    let totalMinutes: number | undefined;
    if (typeof durationMinutes === 'number' && !isNaN(durationMinutes)) {
      totalMinutes = durationMinutes;
    } else if (typeof durationHours === 'number' && !isNaN(durationHours)) {
      totalMinutes = durationHours * 60;
    }
    
    // Only add timer if we have a valid duration
    if (totalMinutes !== undefined && !isNaN(totalMinutes) && totalMinutes > 0) {
      timers.push({
        description: totalMinutes >= 60 
          ? `${Math.floor(totalMinutes / 60)} hora${Math.floor(totalMinutes / 60) > 1 ? 's' : ''} e ${totalMinutes % 60} minutos`
          : `${totalMinutes} minutos`,
        blocking: nextStage.timer.blocking || false
      });
    }
  }
  
  // Build instructions - if stage has no instructions, provide a helpful fallback
  let instructions = nextStage.instructions || [];
  if (instructions.length === 0 && nextStage.name) {
    // Fallback: use the stage name as minimal guidance
    instructions = [`Prossiga com ${nextStage.name.toLowerCase()}.`];
  }
  
  return {
    context: "advance",
    stage: {
      id: nextStage.id,
      name: nextStage.name
    },
    instructions,
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
  
  // For start_batch, show all calculated doses as summary
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
    doses: Object.keys(doses).length > 0 ? doses : undefined,
    allowedUtterances: getContextualUtterances(firstStage, batch)
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
 * Build a SpeechRenderPayload for auto-advance context
 * Used when an operator input is completed and the batch should automatically advance
 * Combines: confirmation of what was saved + next stage info + instructions
 */
export function buildAutoAdvancePayload(
  confirmationMessage: string,
  batch: any,
  nextStage: any
): SpeechRenderPayload {
  const calculatedInputs = batch.calculatedInputs || {};
  
  const doses = getRelevantDosesForStage(nextStage, calculatedInputs);
  
  const timers: TimerInfo[] = [];
  if (nextStage.timer) {
    const durationMinutes = nextStage.timer.duration_minutes;
    const durationHours = nextStage.timer.duration_hours;
    
    let totalMinutes: number | undefined;
    if (typeof durationMinutes === 'number' && !isNaN(durationMinutes)) {
      totalMinutes = durationMinutes;
    } else if (typeof durationHours === 'number' && !isNaN(durationHours)) {
      totalMinutes = durationHours * 60;
    }
    
    if (totalMinutes !== undefined && !isNaN(totalMinutes) && totalMinutes > 0) {
      timers.push({
        description: totalMinutes >= 60 
          ? `${Math.floor(totalMinutes / 60)} hora${Math.floor(totalMinutes / 60) > 1 ? 's' : ''} e ${totalMinutes % 60} minutos`
          : `${totalMinutes} minutos`,
        blocking: nextStage.timer.blocking || false
      });
    }
  }
  
  let instructions = nextStage.instructions || [];
  if (instructions.length === 0 && nextStage.name) {
    instructions = [`Prossiga com ${nextStage.name.toLowerCase()}.`];
  }
  
  return {
    context: "auto_advance",
    confirmation: confirmationMessage,
    stage: {
      id: nextStage.id,
      name: nextStage.name
    },
    instructions,
    doses: Object.keys(doses).length > 0 ? doses : undefined,
    timers: timers.length > 0 ? timers : undefined,
    allowedUtterances: getContextualUtterances(nextStage, batch)
  };
}

/**
 * Get contextual utterances based on current stage and batch state
 * Uses measurements (not storedValues) and returns interactionModel-compatible phrases
 * Order: [required-input-example, "status", "instruções"] - prioritizes the pending input
 */
export function getContextualUtterances(stage: any, batch: any): string[] {
  // Check for operator_input_required
  const requiredInputs = stage?.operator_input_required || [];
  const measurements = batch?.measurements || {};
  
  // Map required inputs to measurement keys
  const inputToMeasurementKey: Record<string, string> = {
    'flocculation_time': 'flocculation_time',
    'cut_point_time': 'cut_point_time',
    'press_start_time': 'press_start_time',
    'ph_value': 'initial_ph',
    'initial_ph': 'initial_ph',
    'pieces_quantity': 'pieces_quantity',
    'chamber_2_entry_date': 'chamber_2_entry_date'
  };
  
  // Find first pending input and put its example FIRST (highest priority)
  for (const input of requiredInputs) {
    const measurementKey = inputToMeasurementKey[input] || input;
    if (measurements[measurementKey] === undefined) {
      // Return exact phrases that match interactionModel samples - INPUT FIRST
      if (input === 'flocculation_time') {
        return ["hora da floculação às quinze e trinta", "qual é o status"];
      }
      if (input === 'cut_point_time') {
        return ["hora do corte às quinze e trinta", "qual é o status"];
      }
      if (input === 'press_start_time') {
        return ["hora da prensa às quinze e trinta", "qual é o status"];
      }
      if (input === 'ph_value' || input === 'initial_ph') {
        // Stage 13 needs pH + pieces
        if (stage?.id === 13) {
          return ["pH cinco vírgula dois com doze peças", "qual é o status"];
        } else {
          return ["pH cinco vírgula dois", "qual é o status"];
        }
      }
      if (input === 'pieces_quantity') {
        return ["doze peças", "qual é o status"];
      }
      if (input === 'chamber_2_entry_date') {
        return ["coloquei na câmara dois hoje", "qual é o status"];
      }
    }
  }
  
  // No pending inputs - suggest advance first
  return ["avançar etapa", "qual é o status", "diga instruções"];
}

/**
 * Get relevant doses for a stage based on stage name and instructions keywords
 * Instead of hardcoding by stage.id, uses keyword matching
 */
export function getRelevantDosesForStage(
  stage: any, 
  calculatedInputs: Record<string, number>
): Record<string, DoseInfo> {
  const doses: Record<string, DoseInfo> = {};
  
  if (!stage || !calculatedInputs) return doses;
  
  // Build searchable text from stage name and instructions
  const stageText = [
    stage.name || '',
    ...(stage.instructions || [])
  ].join(' ').toLowerCase();
  
  // Match doses by keywords
  if (stageText.includes('lr') && calculatedInputs.FERMENT_LR) {
    doses["FERMENT_LR"] = { value: calculatedInputs.FERMENT_LR, unit: "ml" };
  }
  if (stageText.includes('dx') && calculatedInputs.FERMENT_DX) {
    doses["FERMENT_DX"] = { value: calculatedInputs.FERMENT_DX, unit: "ml" };
  }
  if (stageText.includes('kl') && calculatedInputs.FERMENT_KL) {
    doses["FERMENT_KL"] = { value: calculatedInputs.FERMENT_KL, unit: "ml" };
  }
  if (stageText.includes('coalho') && calculatedInputs.RENNET) {
    doses["RENNET"] = { value: calculatedInputs.RENNET, unit: "ml" };
  }
  if (stageText.includes('sal') && calculatedInputs.SALT) {
    doses["SALT"] = { value: calculatedInputs.SALT, unit: "g" };
  }
  
  return doses;
}
