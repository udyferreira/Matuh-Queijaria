import OpenAI from "openai";

export interface InterpretedCommand {
  intent: "status" | "start_batch" | "advance" | "log_time" | "log_date" | "log_number" | "pause" | "resume" | "instructions" | "help" | "goodbye" | "timer" | "query_input" | "repeat_doses" | "unknown";
  confidence: number;
  entities: {
    volume?: number | null;
    milk_temperature?: number | null;
    ph_value?: number | null;
    time_value?: string | null;
    time_type?: "flocculation" | "cut_point" | "press_start" | null;
    date_type?: "chamber_2_entry" | null;
    date_value?: string | null;
    number_type?: "ph_value" | "pieces_quantity" | "milk_temperature" | null;
    number_value?: number | null;
    input_type?: "FERMENT_LR" | "FERMENT_DX" | "FERMENT_KL" | "RENNET" | null;
  };
}

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

const SYSTEM_PROMPT = `Você é um interpretador de comandos de voz para um sistema de produção de queijos artesanais.

Sua única função é:
- interpretar o texto do usuário
- identificar a intenção canônica
- extrair entidades explícitas mencionadas

Você NÃO pode:
- executar ações
- validar regras de processo
- calcular proporções
- assumir dados não ditos
- inferir valores ausentes
- conversar com o usuário

Você SEMPRE deve responder APENAS com um JSON válido,
seguindo exatamente o schema especificado.

Se houver qualquer dúvida, ambiguidade ou falta de informação,
retorne intent = "unknown" com confidence baixa.`;

function buildUserPrompt(text: string): string {
  return `Texto do usuário:
"${text}"

Retorne um JSON no seguinte formato:

{
  "intent": "status | start_batch | advance | log_time | log_date | log_number | pause | resume | instructions | help | goodbye | timer | query_input | unknown",
  "confidence": 0.0,
  "entities": {
    "volume": number | null,
    "milk_temperature": number | null,
    "ph_value": number | null,
    "time_value": string | null,
    "time_type": "flocculation" | "cut_point" | "press_start" | null,
    "date_type": "chamber_2_entry" | null,
    "date_value": string | null,
    "number_type": "ph_value" | "pieces_quantity" | "milk_temperature" | null,
    "number_value": number | null,
    "input_type": "FERMENT_LR" | "FERMENT_DX" | "FERMENT_KL" | "RENNET" | null
  }
}

REGRAS DE INTERPRETAÇÃO:

1. STATUS - Consulta de estado atual:
   - "status", "situação", "qual etapa", "em que etapa", "como está" → intent = "status"

2. LOG_TIME - BLOQUEADO via ProcessCommandIntent:
   - NÃO interprete horários. Registro de horário usa intent estruturada LogTimeIntent.
   - Se o texto mencionar horário de floculação, corte ou prensa → retornar intent = "unknown"
   - O usuário deve usar o comando de voz estruturado: "hora da floculação às quinze e vinte"

3. LOG_DATE - Registro de DATAS de processo:
   - Quando mencionar data + câmara/câmara dois → intent = "log_date"
   - date_type = "chamber_2_entry"
   - Converter data para YYYY-MM-DD:
     - "hoje" → data atual
     - "dia oito do um" → "2026-01-08"
     - "oito de janeiro" → "2026-01-08"

4. LOG_NUMBER - Registro de VALORES numéricos:
   - pH intermediário → number_type = "ph_value"
   - quantidade de peças → number_type = "pieces_quantity"
   - temperatura atual → number_type = "milk_temperature"
   - Extrair number_value como número

5. QUERY_INPUT - Consulta de insumos calculados:
   - SEMPRE retornar query_input quando:
     - Perguntar por quantidade, proporção, valor, quanto, qual, me diga, deste lote
     - Mesmo que a frase seja curta ou informal
   - Mapear input_type OBRIGATORIAMENTE:
     - "kl", "fermento kl", "fermento de kl" → "FERMENT_KL"
     - "lr", "fermento lr", "fermento de lr" → "FERMENT_LR"
     - "dx", "fermento dx", "fermento de x", "de x", "dex", "fermento d x" → "FERMENT_DX"
     - ATENÇÃO: Alexa ASR transcreve "DX" como "de X" - SEMPRE mapear "de x" e "fermento de x" para FERMENT_DX
     - "coalho", "rennet" → "RENNET"
   - NUNCA retornar unknown se um input_type válido puder ser inferido

EXEMPLOS:

STATUS:
"status" → {"intent":"status","confidence":0.95,"entities":{}}
"qual etapa estou" → {"intent":"status","confidence":0.95,"entities":{}}
"em que etapa estamos" → {"intent":"status","confidence":0.95,"entities":{}}

LOG_TIME (BLOQUEADO - usar LogTimeIntent):
"a floculação foi às cinco e vinte" → {"intent":"unknown","confidence":0.5,"entities":{}}
"hora do ponto de corte catorze trinta e nove" → {"intent":"unknown","confidence":0.5,"entities":{}}
NOTA: Horários devem ser registrados via comando estruturado: "hora da floculação às quinze e vinte"

LOG_DATE (datas):
"coloquei na câmara dois hoje" → {"intent":"log_date","confidence":0.95,"entities":{"date_type":"chamber_2_entry","date_value":"2026-01-08"}}
"entrada na câmara dois foi dia oito do um" → {"intent":"log_date","confidence":0.95,"entities":{"date_type":"chamber_2_entry","date_value":"2026-01-08"}}
"foi para a câmara dois em oito de janeiro" → {"intent":"log_date","confidence":0.95,"entities":{"date_type":"chamber_2_entry","date_value":"2026-01-08"}}

LOG_NUMBER (valores):
"o pH agora é cinco ponto dois" → {"intent":"log_number","confidence":0.95,"entities":{"number_type":"ph_value","number_value":5.2}}
"tem doze peças" → {"intent":"log_number","confidence":0.95,"entities":{"number_type":"pieces_quantity","number_value":12}}
"a temperatura está em trinta graus" → {"intent":"log_number","confidence":0.95,"entities":{"number_type":"milk_temperature","number_value":30}}
"temperatura seis vírgula nove graus" → {"intent":"log_number","confidence":0.95,"entities":{"number_type":"milk_temperature","number_value":6.9}}
"são vinte e quatro peças" → {"intent":"log_number","confidence":0.95,"entities":{"number_type":"pieces_quantity","number_value":24}}

QUERY_INPUT (consulta insumos) - PRIORIDADE ALTA:
"quanto de kl" → {"intent":"query_input","confidence":0.95,"entities":{"input_type":"FERMENT_KL"}}
"qual a quantidade de coalho" → {"intent":"query_input","confidence":0.95,"entities":{"input_type":"RENNET"}}
"qual é o kl deste lote" → {"intent":"query_input","confidence":0.95,"entities":{"input_type":"FERMENT_KL"}}
"me diga o lr" → {"intent":"query_input","confidence":0.95,"entities":{"input_type":"FERMENT_LR"}}
"quanto de dx eu uso" → {"intent":"query_input","confidence":0.95,"entities":{"input_type":"FERMENT_DX"}}
"fermento de x" → {"intent":"query_input","confidence":0.95,"entities":{"input_type":"FERMENT_DX"}}
"de x" → {"intent":"query_input","confidence":0.95,"entities":{"input_type":"FERMENT_DX"}}
"fermento de X" → {"intent":"query_input","confidence":0.95,"entities":{"input_type":"FERMENT_DX"}}
"dose de coalho" → {"intent":"query_input","confidence":0.95,"entities":{"input_type":"RENNET"}}
"kl deste lote" → {"intent":"query_input","confidence":0.95,"entities":{"input_type":"FERMENT_KL"}}
"qual o coalho" → {"intent":"query_input","confidence":0.95,"entities":{"input_type":"RENNET"}}

REPEAT_DOSES (repetir todas as doses calculadas):
"repetir fermentos" → {"intent":"repeat_doses","confidence":0.95,"entities":{}}
"quais os fermentos" → {"intent":"repeat_doses","confidence":0.95,"entities":{}}
"me diga os fermentos" → {"intent":"repeat_doses","confidence":0.95,"entities":{}}
"fermentos" → {"intent":"repeat_doses","confidence":0.95,"entities":{}}
"todas as doses" → {"intent":"repeat_doses","confidence":0.95,"entities":{}}

OUTROS:
"avançar" → {"intent":"advance","confidence":0.95,"entities":{}}

START_BATCH (início de lote):
NOTA: O operador pode informar APENAS o volume. Temperatura e pH serão coletados pelo backend em etapas separadas.
Se o operador informar as 3 variáveis juntas, extraia TODAS. Mas NÃO exija que sejam informadas juntas.
NOTA: A temperatura pode ser decimal (ex: 6.9, 7.2). Se o ASR enviar "69", o backend normalizará para 6.9.
"novo lote com 130 litros" → {"intent":"start_batch","confidence":0.95,"entities":{"volume":130}}
"lote com 130 litros" → {"intent":"start_batch","confidence":0.95,"entities":{"volume":130}}
"130 litros" → {"intent":"start_batch","confidence":0.95,"entities":{"volume":130}}
"lote com 130 litros temperatura 32 graus pH 6 ponto 5" → {"intent":"start_batch","confidence":0.95,"entities":{"volume":130,"milk_temperature":32,"ph_value":6.5}}
"novo lote com 80 litros temperatura 35 graus pH 6.5" → {"intent":"start_batch","confidence":0.95,"entities":{"volume":80,"milk_temperature":35,"ph_value":6.5}}

Retorne APENAS o JSON, sem markdown, explicações ou texto adicional.`;
}

// Dicionário de fallback para comandos simples (1-2 palavras)
// Evita chamada ao LLM para palavras-chave conhecidas
// IMPORTANTE: Não incluir palavras ambíguas como "etapa" que podem ser complemento de vários comandos
const SIMPLE_COMMAND_MAP: Record<string, InterpretedCommand["intent"]> = {
  // Status - palavras que CLARAMENTE indicam consulta de status
  "status": "status",
  "situação": "status",
  "situacao": "status",
  "como está": "status",
  "como estamos": "status",
  "qual etapa": "status",
  "qual etapa estou": "status",
  "em que etapa": "status",
  "em que etapa estamos": "status",
  "me diga a etapa": "status",
  "qual é o status": "status",
  "qual o status": "status",
  
  // Advance - verbos de ação para avançar
  // IMPORTANTE: Frases com "etapa" devem vir antes de palavras simples
  // para que "continuar etapa" → advance (não resume)
  "avançar": "advance",
  "avancar": "advance",
  "próxima": "advance",
  "proxima": "advance",
  "próximo": "advance",
  "proximo": "advance",
  "avançar etapa": "advance",
  "avancar etapa": "advance",
  "próxima etapa": "advance",
  "proxima etapa": "advance",
  "continuar etapa": "advance",  // "continuar" + "etapa" = avançar (não resumir)
  "seguir": "advance",
  "seguir etapa": "advance",
  "concluir": "advance",
  "concluir etapa": "advance",
  "finalizar": "advance",
  "finalizar etapa": "advance",
  "prosseguir": "advance",
  "prosseguir etapa": "advance",
  
  // Help
  "ajuda": "help",
  "ajudar": "help",
  "socorro": "help",
  "comandos": "help",
  "opções": "help",
  "opcoes": "help",
  
  // Pause
  "pausar": "pause",
  "pausa": "pause",
  "parar": "pause",
  
  // Resume - "continuar" sem "etapa" = resume
  "continuar": "resume",
  "retomar": "resume",
  "resumir": "resume",
  "despausar": "resume",
  
  // Instructions - palavras que indicam pedido de instrução
  "instruções": "instructions",
  "instrucoes": "instructions",
  "instrução": "instructions",
  "instrucao": "instructions",
  "o que fazer": "instructions",
  "o que faço": "instructions",
  "o que faco": "instructions",
  "como fazer": "instructions",
  "passos": "instructions",
  
  // Timer
  "timer": "timer",
  "tempo": "timer",
  "quanto falta": "timer",
  "tempo restante": "timer",
  "cronômetro": "timer",
  "cronometro": "timer",
  
  // Repeat doses
  "repetir fermentos": "repeat_doses",
  "repetir doses": "repeat_doses",
  "repetir as doses": "repeat_doses",
  "quais os fermentos": "repeat_doses",
  "quais são os fermentos": "repeat_doses",
  "me diga os fermentos": "repeat_doses",
  "todos os fermentos": "repeat_doses",
  "fermentos": "repeat_doses",
  "todas as doses": "repeat_doses",
  "repete os fermentos": "repeat_doses",
  "repete as doses": "repeat_doses",
  "repetir ingredientes": "repeat_doses",
  "quais as quantidades": "repeat_doses",
  
  // Goodbye
  "tchau": "goodbye",
  "adeus": "goodbye",
  "encerrar": "goodbye",
  "sair": "goodbye",
  "fechar": "goodbye",
};

// Mapeamento de palavras-chave para input_type de insumos
const INPUT_TYPE_MAP: Record<string, InterpretedCommand["entities"]["input_type"]> = {
  "kl": "FERMENT_KL",
  "fermento kl": "FERMENT_KL",
  "fermento k l": "FERMENT_KL",
  "fermento de kl": "FERMENT_KL",
  "fermento de k l": "FERMENT_KL",
  "lr": "FERMENT_LR",
  "fermento lr": "FERMENT_LR",
  "fermento l r": "FERMENT_LR",
  "fermento de lr": "FERMENT_LR",
  "fermento de l r": "FERMENT_LR",
  "dx": "FERMENT_DX",
  "fermento dx": "FERMENT_DX",
  "fermento d x": "FERMENT_DX",
  "de x": "FERMENT_DX",
  "fermento de x": "FERMENT_DX",
  "fermento dex": "FERMENT_DX",
  "dex": "FERMENT_DX",
  "fermento de xt": "FERMENT_DX",
  "coalho": "RENNET",
  "rennet": "RENNET",
};

// Palavras que indicam consulta de quantidade/valor
const QUERY_INDICATORS = /\b(quanto|qual|quantidade|proporção|proporcao|dose|me diga|deste lote|qual é|qual e|quanto de|quanto do)\b/i;

// High-priority pattern for start_batch
// Matches: "lote com X litros", "novo lote com X litros"
// Also extracts temperature and pH if present
// Temperature can be: "32", "6,9", "6 ponto 9", "6 vírgula 9", "69" (ASR drops decimal)
// pH can be: "6.5", "6,5", "6 ponto 5", "6 vírgula 5"
const START_BATCH_PATTERN = /(?:novo\s+)?lote\s+com\s+(\d+)\s*litros?(?:.*?temperatura\s*(\d+\s*(?:ponto|virgula|vírgula)\s*\d+|\d+[.,]\d+|\d+)\s*graus?)?(?:.*?(?:ph|p\s*h)\s*(\d+\s*(?:ponto|virgula|vírgula)\s*\d+|\d+[.,]\d+|\d+))?/i;

function tryStartBatchFallback(text: string): InterpretedCommand | null {
  const normalized = text.toLowerCase().trim();
  const match = normalized.match(START_BATCH_PATTERN);
  
  if (match) {
    const volume = parseInt(match[1], 10);
    const entities: InterpretedCommand["entities"] = { volume };
    
    if (match[2]) {
      let tempStr = match[2].replace(/\s*(ponto|virgula|vírgula)\s*/gi, '.');
      tempStr = tempStr.replace(',', '.');
      entities.milk_temperature = parseFloat(tempStr);
    }
    
    if (match[3]) {
      let phStr = match[3].replace(/\s*(ponto|virgula|vírgula)\s*/gi, '.');
      phStr = phStr.replace(',', '.');
      entities.ph_value = parseFloat(phStr);
    }
    
    console.log(`Start batch detected: volume=${volume}, temp=${entities.milk_temperature}, pH=${entities.ph_value} (from "${normalized}")`);
    return {
      intent: "start_batch",
      confidence: 0.95,
      entities
    };
  }
  
  return null;
}

function tryQueryInputFallback(text: string): InterpretedCommand | null {
  const normalized = text.toLowerCase().trim();
  
  // Verificar se tem indicador de consulta
  const hasQueryIndicator = QUERY_INDICATORS.test(normalized);
  
  // Verificar se menciona algum insumo (testar keywords mais longas primeiro para prioridade)
  const sortedInputEntries = Object.entries(INPUT_TYPE_MAP)
    .sort((a, b) => b[0].length - a[0].length);
  for (const [keyword, inputType] of sortedInputEntries) {
    const keywordPattern = new RegExp(`\\b${keyword.replace(/\s+/g, '\\s+')}\\b`, 'i');
    if (keywordPattern.test(normalized)) {
      // Se menciona insumo com indicador de consulta, ou é uma frase curta sobre insumo
      if (hasQueryIndicator || normalized.split(/\s+/).length <= 4) {
        console.log(`Query input detected: ${inputType} (from "${normalized}")`);
        return {
          intent: "query_input",
          confidence: 0.95,
          entities: { input_type: inputType }
        };
      }
    }
  }
  
  return null;
}

function trySimpleFallback(text: string): InterpretedCommand | null {
  const normalized = text.toLowerCase().trim();
  
  // 0. PRIORIDADE MÁXIMA: start_batch para "lote com X litros"
  // Isso é crítico porque o slot {utterance} remove o verbo "iniciar"
  const startBatchResult = tryStartBatchFallback(normalized);
  if (startBatchResult) {
    return startBatchResult;
  }
  
  // 1. Verificar query_input para consultas de insumos
  // (prioridade alta para evitar que vá para unknown)
  const queryInputResult = tryQueryInputFallback(normalized);
  if (queryInputResult) {
    return queryInputResult;
  }
  
  // Apenas para comandos curtos (até 3 palavras)
  const wordCount = normalized.split(/\s+/).length;
  if (wordCount > 3) {
    return null;
  }
  
  // 1. Verificar match exato primeiro (maior prioridade)
  if (SIMPLE_COMMAND_MAP[normalized]) {
    console.log(`Fallback exact match: "${normalized}" → ${SIMPLE_COMMAND_MAP[normalized]}`);
    return {
      intent: SIMPLE_COMMAND_MAP[normalized],
      confidence: 1.0,
      entities: {}
    };
  }
  
  // 2. Verificar frases multi-palavra no mapa (ex: "continuar etapa" antes de "continuar")
  // Ordenar por tamanho decrescente para priorizar matches mais específicos
  const sortedEntries = Object.entries(SIMPLE_COMMAND_MAP)
    .sort((a, b) => b[0].length - a[0].length);
  
  for (const [keyword, intent] of sortedEntries) {
    // Verificar se a frase contém a keyword como palavra completa
    // Usar regex para evitar matches parciais dentro de palavras
    const keywordPattern = new RegExp(`\\b${keyword.replace(/\s+/g, '\\s+')}\\b`, 'i');
    if (keywordPattern.test(normalized)) {
      console.log(`Fallback phrase match: "${normalized}" matches "${keyword}" → ${intent}`);
      return {
        intent,
        confidence: 0.95,
        entities: {}
      };
    }
  }
  
  return null;
}

export async function interpretCommand(text: string): Promise<InterpretedCommand> {
  const normalizedText = text.toLowerCase().trim();
  
  if (!normalizedText) {
    return {
      intent: "unknown",
      confidence: 0.0,
      entities: {}
    };
  }

  // Tentar fallback para comandos simples primeiro
  const fallbackResult = trySimpleFallback(normalizedText);
  if (fallbackResult) {
    return fallbackResult;
  }

  // Comandos complexos ou com entidades vão para o LLM
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: SYSTEM_PROMPT
        },
        {
          role: "user",
          content: buildUserPrompt(normalizedText)
        }
      ],
      temperature: 0.0,
      max_tokens: 200
    });

    const content = response.choices[0]?.message?.content?.trim();
    if (!content) {
      return { intent: "unknown", confidence: 0.0, entities: {} };
    }

    let jsonContent = content;
    if (content.startsWith("```")) {
      jsonContent = content.replace(/```json?\s*/g, "").replace(/```\s*$/g, "").trim();
    }

    const parsed = JSON.parse(jsonContent) as InterpretedCommand;
    
    const validIntents = ["status", "start_batch", "advance", "log_time", "log_date", "log_number", "pause", "resume", "instructions", "help", "goodbye", "timer", "query_input", "unknown"];
    if (!parsed.intent || !validIntents.includes(parsed.intent)) {
      return { intent: "unknown", confidence: 0.0, entities: {} };
    }

    const cleanEntities: InterpretedCommand["entities"] = {};
    if (parsed.entities) {
      if (typeof parsed.entities.volume === "number") cleanEntities.volume = parsed.entities.volume;
      if (typeof parsed.entities.milk_temperature === "number") cleanEntities.milk_temperature = parsed.entities.milk_temperature;
      if (typeof parsed.entities.ph_value === "number") cleanEntities.ph_value = parsed.entities.ph_value;
      if (typeof parsed.entities.time_value === "string") cleanEntities.time_value = parsed.entities.time_value;
      if (parsed.entities.time_type && ["flocculation", "cut_point", "press_start"].includes(parsed.entities.time_type)) {
        cleanEntities.time_type = parsed.entities.time_type;
      }
      if (parsed.entities.date_type === "chamber_2_entry") {
        cleanEntities.date_type = parsed.entities.date_type;
      }
      if (typeof parsed.entities.date_value === "string") cleanEntities.date_value = parsed.entities.date_value;
      if (parsed.entities.number_type && ["ph_value", "pieces_quantity", "milk_temperature"].includes(parsed.entities.number_type)) {
        cleanEntities.number_type = parsed.entities.number_type;
      }
      if (typeof parsed.entities.number_value === "number") cleanEntities.number_value = parsed.entities.number_value;
      if (parsed.entities.input_type && ["FERMENT_LR", "FERMENT_DX", "FERMENT_KL", "RENNET"].includes(parsed.entities.input_type)) {
        cleanEntities.input_type = parsed.entities.input_type;
      }
    }

    return {
      intent: parsed.intent,
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.5,
      entities: cleanEntities
    };

  } catch (error) {
    console.error("LLM interpretation error:", error);
    return {
      intent: "unknown",
      confidence: 0.0,
      entities: {}
    };
  }
}
