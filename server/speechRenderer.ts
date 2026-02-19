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
  | "repeat_doses"
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

export interface NextAction {
  kind: "register" | "do_then_advance";
  phrase: string;
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
  nextAction?: NextAction;
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

const SPEECH_RENDERER_PROMPT = `Sua função é APENAS narrar uma resposta de voz curta para Alexa, em português do Brasil.
Você receberá um JSON estruturado com dados já validados pelo backend.
Use SOMENTE as informações fornecidas no JSON.
NUNCA invente dados, frases, pedidos ou instruções que não estejam no JSON.

REGRAS OBRIGATÓRIAS:
1. NUNCA comece com "Confirmação" ou "confirmação".
2. Se houver stage, diga "Etapa {id}: {nome}." no início.
3. Se houver instructions, diga-as de forma clara APÓS o nome da etapa.
   - NUNCA repita o nome da etapa dentro da instrução.
   - NUNCA diga "Prossiga com [nome da etapa]" — é redundante.
4. Se instructions estiver vazio ou ausente, NÃO invente instruções.
5. Rótulos de doses OBRIGATÓRIOS (use exatamente):
   - "coalho" (NUNCA "rennet")
   - "fermento D X" (NUNCA "fermento DX" junto, nem "fermento quinhentos e dez")
   - "fermento L R" (NUNCA "fermento LR" junto)
   - "fermento K L" (NUNCA "fermento KL" junto)
6. Se houver timers, mencione brevemente (ex: "Timer de 30 minutos").
7. Se houver notes, diga exatamente o que está em notes.
8. Se notes estiver ausente, NÃO invente.
9. REGRA CRÍTICA DE COMANDOS — nextAction é SOBERANO:
   - Se nextAction.kind="register": diga de forma direta que precisa registrar antes de continuar, usando nextAction.phrase LITERALMENTE. NÃO mencione "avançar etapa", "próxima etapa" nem sinônimos.
   - Se nextAction.kind="do_then_advance": termine com "Quando terminar, diga 'avançar etapa'." usando nextAction.phrase LITERALMENTE.
   - Se nextAction estiver ausente: NÃO sugira nenhum comando por conta própria.
   - Você DEVE citar APENAS exemplos contidos em allowedUtterances. NÃO invente frases.
   - Se "avançar etapa" NÃO estiver em allowedUtterances, você NÃO pode mencionar "avançar etapa" nem sinônimos ("próxima etapa", "concluir etapa", "prosseguir").
   - NUNCA sugira "qual é o status" por conta própria.
10. Para error, diga a mensagem de erro de forma clara.
11. Para query_input, diga "A quantidade de [tipo] é [valor] [unidade]."
12. Para auto_advance: combine confirmation + próxima etapa numa narrativa fluida e curta. NÃO diga "confirmação".
13. Para start_batch: primeiro anuncie "Fermentos e coalho calculados:" e liste TODAS as doses. Depois diga a instrução da etapa atual (ex: "Agora, etapa 3: Aqueça o leite até 32°C"). Termine com "Para ouvir novamente, diga 'repetir fermentos'." NÃO leia o campo notes literalmente.
14. Para repeat_doses: liste TODAS as doses presentes dizendo "As doses deste lote são:" seguido de cada dose. Use os rótulos obrigatórios da regra 5.
15. Para log_time/log_ph/log_date: confirme o registro feito de forma curta.
16. Máximo: 5 frases para start_batch (doses + instrução), 4 para auto_advance, 3 para outros contextos.
17. NUNCA repita o nome da etapa 2 vezes. Evitar "Etapa X… Prossiga com etapa X…"

Responda APENAS com o texto de fala, sem aspas, sem explicações.`;

/**
 * Post-process LLM or fallback speech to fix pronunciation and remove redundancies
 */
function postProcessSpeech(text: string): string {
  let result = text;

  result = result.replace(/^[Cc]onfirma[çc][ãa]o\.?\s*/g, '');
  result = result.replace(/\brennet\b/gi, 'coalho');

  result = result.replace(/\bDX\b/g, 'D X');
  result = result.replace(/\bLR\b/g, 'L R');
  result = result.replace(/\bKL\b/g, 'K L');

  result = result.replace(/\.?\s*Prossiga com [^.]+\./gi, '.');
  result = result.replace(/Sugest[õo]es de comandos:\s*/gi, '');

  result = result.replace(/\n+/g, ' ');
  result = result.replace(/\.\s*\./g, '.');
  result = result.replace(/\s{2,}/g, ' ');
  result = result.trim();

  return result;
}

/**
 * Compute nextAction from allowedUtterances
 * This determines what the LLM is allowed to suggest as the user's next command
 */
function computeNextAction(allowedUtterances?: string[]): NextAction | undefined {
  if (!allowedUtterances || allowedUtterances.length === 0) return undefined;
  
  const first = allowedUtterances[0];
  if (first === 'avançar etapa') {
    return { kind: "do_then_advance", phrase: "Quando terminar, diga 'avançar etapa'." };
  }
  return { kind: "register", phrase: `Diga: '${first}'.` };
}

/**
 * Guardrail: check if LLM output contains "avançar etapa" or synonyms when NOT in allowedUtterances
 * Returns true if a violation was detected (LLM invented a command)
 */
function checkAdvanceGuardrail(speech: string, allowedUtterances?: string[]): boolean {
  if (!allowedUtterances) return false;
  
  const hasAdvanceAllowed = allowedUtterances.some(u => u === 'avançar etapa');
  if (hasAdvanceAllowed) return false;
  
  const speechLower = speech.toLowerCase();
  const forbiddenPatterns = [
    'avançar etapa',
    'próxima etapa',
    'concluir etapa',
    'prosseguir para',
    'seguir para a próxima',
    "diga 'avançar",
    'diga "avançar',
    'quando terminar, diga',
  ];
  
  for (const pattern of forbiddenPatterns) {
    if (speechLower.includes(pattern)) {
      return true;
    }
  }
  return false;
}

/**
 * Render structured data into natural speech using LLM
 */
export async function renderSpeech(payload: SpeechRenderPayload): Promise<string> {
  if (!payload.nextAction && payload.allowedUtterances) {
    payload.nextAction = computeNextAction(payload.allowedUtterances);
  }
  
  const payloadJson = JSON.stringify(payload, null, 2);
  
  console.log(`[llm.render.input] context=${payload.context} stage=${payload.stage?.id || 'N/A'} payload=${payloadJson}`);
  
  let usedGuardrail = false;
  
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
    
    if (payload.allowedUtterances && payload.allowedUtterances.length > 0) {
      const violation = checkForViolation(speech, payload.allowedUtterances);
      if (violation) {
        console.log(`[llm.render.violation] LLM suggested "${violation}" which is not in allowedUtterances`);
        speech = getFallbackSpeech(payload);
        usedGuardrail = true;
      }
    }
    
    if (!usedGuardrail && checkAdvanceGuardrail(speech, payload.allowedUtterances)) {
      console.log(`[LLM_GUARDRAIL] LLM invented "avançar etapa" when not in allowedUtterances. Falling back to deterministic speech.`);
      speech = getFallbackSpeech(payload);
      usedGuardrail = true;
    }
    
    speech = postProcessSpeech(speech);
    
    console.log(`[llm.render.output] "${speech}"`);
    console.log(`[SPEECH] context=${payload.context} stageId=${payload.stage?.id || 'N/A'} stageName=${payload.stage?.name || 'N/A'} nextAction=${payload.nextAction ? `${payload.nextAction.kind}:${payload.nextAction.phrase}` : 'none'} pendingInputs=${payload.notes || 'none'} timers=${payload.timers?.map(t => t.description).join(',') || 'none'} allowedUtterances=${payload.allowedUtterances?.join(',') || 'none'} [LLM_GUARDRAIL]=${usedGuardrail} speech="${speech.substring(0, 150)}"`);
    
    return speech;
  } catch (error) {
    console.error("[llm.render.error]", error);
    const fallback = postProcessSpeech(getFallbackSpeech(payload));
    console.log(`[SPEECH] context=${payload.context} stageId=${payload.stage?.id || 'N/A'} FALLBACK speech="${fallback.substring(0, 150)}"`);
    return fallback;
  }
}

/**
 * Fallback speech generation when LLM fails
 * Uses deterministic logic - clean, non-redundant output
 */
function getFallbackSpeech(payload: SpeechRenderPayload): string {
  const parts: string[] = [];
  
  if (payload.context === 'repeat_doses' && payload.doses) {
    const doseTexts = Object.entries(payload.doses)
      .map(([name, info]) => `${info.value} ${info.unit} de ${formatDoseName(name)}`)
      .join(', ');
    return `As doses deste lote são: ${doseTexts}.`;
  }
  
  if (payload.confirmation) {
    parts.push(payload.confirmation);
  }
  
  if (payload.batchInfo) {
    parts.push(`Lote iniciado com ${payload.batchInfo.milkVolumeL} litros.`);
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
  
  if (payload.loggedValue) {
    parts.push(`${payload.loggedValue.type}: ${payload.loggedValue.value} registrado.`);
  }
  
  if (payload.doses) {
    const doseTexts = Object.entries(payload.doses)
      .map(([name, info]) => `${info.value} ${info.unit} de ${formatDoseName(name)}`)
      .join(', ');
    if (doseTexts) parts.push(`Doses: ${doseTexts}.`);
  }
  
  if (payload.instructions && payload.instructions.length > 0) {
    const filtered = payload.instructions.filter(i =>
      !i.toLowerCase().startsWith('prossiga com')
    );
    if (filtered.length > 0) {
      const joined = filtered.slice(0, 2).join('. ');
      parts.push(joined.endsWith('.') ? joined : joined + '.');
    }
  }
  
  if (payload.notes) {
    parts.push(payload.notes);
  }
  
  if (payload.timers && payload.timers.length > 0) {
    for (const timer of payload.timers) {
      if (timer.remainingMinutes !== undefined && !isNaN(timer.remainingMinutes) && timer.remainingMinutes > 0) {
        parts.push(`Faltam ${timer.remainingMinutes} minuto${timer.remainingMinutes !== 1 ? 's' : ''}.`);
      } else if (timer.description && !timer.description.includes('NaN')) {
        parts.push(`Timer de ${timer.description}.`);
      }
    }
  }
  
  if (payload.allowedUtterances && payload.allowedUtterances.length > 0) {
    if (payload.context === 'help' || payload.context === 'error') {
      const examples = payload.allowedUtterances.slice(0, 2).join(' ou ');
      parts.push(`Você pode dizer: ${examples}.`);
    } else {
      const first = payload.allowedUtterances[0];
      if (first === 'avançar etapa') {
        parts.push("Quando terminar, diga 'avançar etapa'.");
      } else {
        parts.push(`Diga: '${first}'.`);
      }
    }
  }
  
  return parts.join(' ') || "Não foi possível processar sua solicitação.";
}

function formatDoseName(name: string): string {
  const nameMap: Record<string, string> = {
    "FERMENT_LR": "fermento L R",
    "FERMENT_DX": "fermento D X", 
    "FERMENT_KL": "fermento K L",
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
  
  const wrongStagePhrases = [
    { pattern: /hora da floculação/, validFor: ['floculação'] },
    { pattern: /hora do corte/, validFor: ['corte'] },
    { pattern: /hora da prensa/, validFor: ['prensa'] },
    { pattern: /registrar.*floculação/, validFor: ['floculação'] },
    { pattern: /registrar.*corte/, validFor: ['corte'] },
    { pattern: /registrar.*prensa/, validFor: ['prensa'] },
  ];
  
  const allowedTopics = allowedUtterances.map(u => u.toLowerCase()).join(' ');
  
  for (const phrase of wrongStagePhrases) {
    if (phrase.pattern.test(speechLower)) {
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
  
  const doses = getRelevantDosesForStage(stage, calculatedInputs);
  
  const timers: TimerInfo[] = [];
  const activeTimers = batch.activeTimers || [];
  for (const timer of activeTimers) {
    const remaining = timer.endTime ? Math.max(0, Math.ceil((new Date(timer.endTime).getTime() - Date.now()) / 60000)) : 0;
    const desc = timer.description || (timer.durationMinutes && !isNaN(timer.durationMinutes) ? `${timer.durationMinutes} minutos` : undefined);
    if (desc && !desc.includes('NaN')) {
      timers.push({
        description: desc,
        blocking: timer.blocking || false,
        remainingMinutes: remaining
      });
    }
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
 * Build timer description from stage recipe definition
 * Returns undefined if duration is invalid/NaN
 */
function buildTimerDescription(stageTimer: any): string | undefined {
  const durationMin = stageTimer.duration_min;
  const durationHours = stageTimer.duration_hours;
  
  let totalMinutes: number | undefined;
  if (typeof durationMin === 'number' && !isNaN(durationMin)) {
    totalMinutes = durationMin;
  } else if (typeof durationHours === 'number' && !isNaN(durationHours)) {
    totalMinutes = durationHours * 60;
  }
  
  if (totalMinutes === undefined || isNaN(totalMinutes) || totalMinutes <= 0) {
    return undefined;
  }
  
  if (totalMinutes >= 60) {
    const hours = Math.floor(totalMinutes / 60);
    const mins = totalMinutes % 60;
    if (mins === 0) {
      return `${hours} hora${hours > 1 ? 's' : ''}`;
    }
    return `${hours} hora${hours > 1 ? 's' : ''} e ${mins} minutos`;
  }
  return `${totalMinutes} minutos`;
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
      stage: { id: 21, name: "Conclusão" },
      notes: "Lote finalizado com sucesso! Todas as etapas foram concluídas.",
      allowedUtterances: ["qual é o status", "iniciar novo lote"]
    };
  }
  
  const calculatedInputs = batch.calculatedInputs || {};
  
  const doses = getRelevantDosesForStage(nextStage, calculatedInputs);
  
  const timers: TimerInfo[] = [];
  if (nextStage.timer) {
    const desc = buildTimerDescription(nextStage.timer);
    if (desc) {
      timers.push({
        description: desc,
        blocking: nextStage.timer.blocking || false
      });
    }
  }
  
  const instructions = nextStage.instructions || [];
  
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
  let utterances: string[];
  if (stage && batch) {
    const contextual = getContextualUtterances(stage, batch);
    utterances = [...contextual, "qual é o status", "ajuda"];
    utterances = Array.from(new Set(utterances));
  } else {
    utterances = ["qual é o status", "iniciar novo lote com 130 litros, temperatura 32 graus, pH seis vírgula cinco"];
  }
  
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
 * Announces etapa 2 (calculated doses) then etapa 3 instruction (no doses)
 */
export function buildStartBatchPayload(
  batch: any,
  currentStage: any
): SpeechRenderPayload {
  const calculatedInputs = batch.calculatedInputs || {};
  
  const doses: Record<string, DoseInfo> = {};
  if (calculatedInputs.FERMENT_LR) doses["FERMENT_LR"] = { value: calculatedInputs.FERMENT_LR, unit: "ml" };
  if (calculatedInputs.FERMENT_DX) doses["FERMENT_DX"] = { value: calculatedInputs.FERMENT_DX, unit: "ml" };
  if (calculatedInputs.FERMENT_KL) doses["FERMENT_KL"] = { value: calculatedInputs.FERMENT_KL, unit: "ml" };
  if (calculatedInputs.RENNET) doses["RENNET"] = { value: calculatedInputs.RENNET, unit: "ml" };
  
  let instructions = currentStage.instructions || [];
  if (instructions.length === 0 && currentStage.type === 'heat' && currentStage.parameters?.target_temp_c) {
    instructions = [`Aqueça o leite até ${currentStage.parameters.target_temp_c}°C.`];
  }
  
  return {
    context: "start_batch",
    batchInfo: {
      milkVolumeL: batch.milkVolumeL,
      startedAt: batch.startedAt
    },
    stage: {
      id: currentStage.id,
      name: currentStage.name
    },
    instructions,
    doses: Object.keys(doses).length > 0 ? doses : undefined,
    allowedUtterances: getContextualUtterances(currentStage, batch)
  };
}

/**
 * Build a SpeechRenderPayload for repeat_doses context
 * Lists all calculated doses for the active batch
 */
export function buildRepeatDosesPayload(
  batch: any
): SpeechRenderPayload {
  const calculatedInputs = batch.calculatedInputs || {};
  
  const doses: Record<string, DoseInfo> = {};
  if (calculatedInputs.FERMENT_LR) doses["FERMENT_LR"] = { value: calculatedInputs.FERMENT_LR, unit: "ml" };
  if (calculatedInputs.FERMENT_DX) doses["FERMENT_DX"] = { value: calculatedInputs.FERMENT_DX, unit: "ml" };
  if (calculatedInputs.FERMENT_KL) doses["FERMENT_KL"] = { value: calculatedInputs.FERMENT_KL, unit: "ml" };
  if (calculatedInputs.RENNET) doses["RENNET"] = { value: calculatedInputs.RENNET, unit: "ml" };
  
  return {
    context: "repeat_doses",
    doses: Object.keys(doses).length > 0 ? doses : undefined,
  };
}

/**
 * Build a SpeechRenderPayload for launch/welcome context
 */
export function buildLaunchPayload(): SpeechRenderPayload {
  return {
    context: "help",
    notes: "Bem-vindo à Matuh Queijaria!",
    allowedUtterances: ["qual é o status", "iniciar novo lote com 130 litros, temperatura 32 graus, pH seis vírgula cinco"]
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
    const desc = buildTimerDescription(nextStage.timer);
    if (desc) {
      timers.push({
        description: desc,
        blocking: nextStage.timer.blocking || false
      });
    }
  }
  
  const instructions = nextStage.instructions || [];
  
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
 * Returns interactionModel-compatible phrases
 * 
 * RULES:
 * - Stages with pending input: return only the input example (no "status", no "avançar etapa")
 * - Stages without pending input: return only "avançar etapa" (no "status")
 * - "qual é o status" is only included in help/error contexts (handled by buildHelpPayload)
 * - Stage 19: checks batch.chamber2EntryDate (top-level), NOT measurements
 */
export function getContextualUtterances(stage: any, batch: any): string[] {
  const requiredInputs = stage?.operator_input_required || [];
  const measurements = batch?.measurements || {};
  
  const inputToMeasurementKey: Record<string, string> = {
    'flocculation_time': 'flocculation_time',
    'cut_point_time': 'cut_point_time',
    'press_start_time': 'press_start_time',
    'ph_value': 'initial_ph',
    'initial_ph': 'initial_ph',
    'pieces_quantity': 'pieces_quantity',
  };
  
  for (const input of requiredInputs) {
    if (input === 'chamber_2_entry_date') {
      if (!batch?.chamber2EntryDate) {
        return ["coloquei na câmara dois hoje"];
      }
      continue;
    }
    
    const measurementKey = inputToMeasurementKey[input] || input;
    if (measurements[measurementKey] === undefined) {
      if (input === 'flocculation_time') {
        return ["hora da floculação às vinte e três e nove"];
      }
      if (input === 'cut_point_time') {
        return ["hora do corte às quinze e trinta"];
      }
      if (input === 'press_start_time') {
        return ["hora da prensa às dezesseis e dez"];
      }
      if (input === 'ph_value' || input === 'initial_ph') {
        if (stage?.id === 13) {
          return ["pH cinco vírgula dois com doze peças"];
        } else {
          return ["pH cinco vírgula dois"];
        }
      }
      if (input === 'pieces_quantity') {
        return ["doze peças"];
      }
    }
  }
  
  return ["avançar etapa"];
}

/**
 * Get list of pending inputs for a stage, using correct data sources
 * Stage 19: checks batch.chamber2EntryDate (top-level field)
 * Other stages: checks batch.measurements
 */
export function getPendingInputs(batch: any, stageId: number, stage: any): string[] {
  const requiredInputs = stage?.operator_input_required || [];
  if (requiredInputs.length === 0) return [];
  
  const measurements = batch?.measurements || {};
  const pending: string[] = [];
  
  const inputToMeasurementKey: Record<string, string> = {
    'flocculation_time': 'flocculation_time',
    'cut_point_time': 'cut_point_time',
    'press_start_time': 'press_start_time',
    'ph_value': 'initial_ph',
    'initial_ph': 'initial_ph',
    'pieces_quantity': 'pieces_quantity',
  };
  
  for (const input of requiredInputs) {
    if (input === 'chamber_2_entry_date') {
      if (!batch?.chamber2EntryDate) {
        pending.push('chamber_2_entry_date');
      }
      continue;
    }
    
    if (input === 'milk_volume_l') {
      if (!batch?.milkVolumeL) pending.push('milk_volume_l');
      continue;
    }
    
    const measurementKey = inputToMeasurementKey[input] || input;
    if (measurements[measurementKey] === undefined) {
      pending.push(input);
    }
  }
  
  return pending;
}

/**
 * Get relevant doses for a stage based on stage name and instructions keywords
 * Instead of hardcoding by stage.id, uses keyword matching
 * Stages 3 and 4 never show doses (doses are announced in etapa 2 at start_batch)
 */
export function getRelevantDosesForStage(
  stage: any, 
  calculatedInputs: Record<string, number>
): Record<string, DoseInfo> {
  const doses: Record<string, DoseInfo> = {};
  
  if (!stage || !calculatedInputs) return doses;
  
  if (stage.id === 3 || stage.id === 4) return doses;
  
  const stageText = [
    stage.name || '',
    ...(stage.instructions || [])
  ].join(' ').toLowerCase();
  
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
