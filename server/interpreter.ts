import OpenAI from "openai";

export interface InterpretedCommand {
  intent: "status" | "start_batch" | "advance" | "log_ph" | "log_time" | "log_temperature" | "pause" | "resume" | "instructions" | "help" | "goodbye" | "timer" | "query_input" | "unknown";
  confidence: number;
  entities: {
    volume?: number | null;
    milk_temperature?: number | null;
    ph_value?: number | null;
    time_value?: string | null;
    time_type?: "flocculation" | "cut" | "press" | null;
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
  "intent": "status | start_batch | advance | log_ph | log_time | log_temperature | pause | resume | instructions | help | goodbye | timer | query_input | unknown",
  "confidence": 0.0,
  "entities": {
    "volume": number | null,
    "milk_temperature": number | null,
    "ph_value": number | null,
    "time_value": string | null,
    "time_type": "flocculation" | "cut" | "press" | null,
    "input_type": "FERMENT_LR" | "FERMENT_DX" | "FERMENT_KL" | "RENNET" | null
  }
}

Regras de extração:
- volume: litros de leite mencionados (ex: "50 litros" → 50, "cento e vinte" → 120)
- milk_temperature: temperatura do leite em graus (ex: "35 graus" → 35)
- ph_value: valor de pH mencionado (ex: "seis ponto sete" → 6.7, "pH 5.2" → 5.2)
- time_value: horário no formato "HH:MM" - SEMPRE converter horário falado para HH:MM
  - "cinco e vinte" → "05:20"
  - "dezessete e quarenta" → "17:40"
  - "dez e meia" → "10:30"
  - "às oito" → "08:00"
  - "meio-dia" → "12:00"
- time_type: tipo do registro de tempo - floculação, corte ou prensagem
- input_type: tipo de insumo consultado - mapear nomes para códigos:
  - LR, fermento LR → FERMENT_LR
  - DX, fermento DX → FERMENT_DX
  - KL, fermento KL → FERMENT_KL
  - coalho, rennet → RENNET

REGRAS DE INTERPRETAÇÃO:

1. REGISTRO DE HORÁRIO (log_time):
   - Se o usuário menciona floculação + horário → intent = "log_time"
   - Extrair time_type = "flocculation" e time_value = "HH:MM"
   - Exemplos: "a floculação foi às cinco e vinte", "anota floculação dezessete e quarenta"

2. CONSULTA DE INSUMOS (query_input):
   - Se o usuário pergunta quantidade/quanto/dose de um insumo → intent = "query_input"
   - Mapear o nome do insumo para input_type
   - Exemplos: "qual a quantidade de LR", "quanto de DX eu uso", "dose de coalho"

3. Se o comando for ambíguo ou incompleto → intent = "unknown"

Exemplos de interpretação:

COMANDOS CURTOS (1-2 palavras):
"status" → {"intent":"status","confidence":0.95,"entities":{}}
"avançar" → {"intent":"advance","confidence":0.95,"entities":{}}
"timer" → {"intent":"timer","confidence":0.95,"entities":{}}

REGISTRO DE HORÁRIOS:
"a floculação foi às cinco e vinte" → {"intent":"log_time","confidence":0.95,"entities":{"time_value":"05:20","time_type":"flocculation"}}
"anota a floculação às dezessete e quarenta" → {"intent":"log_time","confidence":0.95,"entities":{"time_value":"17:40","time_type":"flocculation"}}
"floculação dez e quinze" → {"intent":"log_time","confidence":0.95,"entities":{"time_value":"10:15","time_type":"flocculation"}}
"hora do corte foi oito e meia" → {"intent":"log_time","confidence":0.9,"entities":{"time_value":"08:30","time_type":"cut"}}

CONSULTA DE INSUMOS:
"qual a quantidade de LR" → {"intent":"query_input","confidence":0.95,"entities":{"input_type":"FERMENT_LR"}}
"quanto de fermento DX eu uso" → {"intent":"query_input","confidence":0.95,"entities":{"input_type":"FERMENT_DX"}}
"a quantidade de LR" → {"intent":"query_input","confidence":0.9,"entities":{"input_type":"FERMENT_LR"}}
"dose de coalho" → {"intent":"query_input","confidence":0.95,"entities":{"input_type":"RENNET"}}
"quanto de KL" → {"intent":"query_input","confidence":0.95,"entities":{"input_type":"FERMENT_KL"}}

COMANDOS COM ENTIDADES:
"iniciar lote com 120 litros" → {"intent":"start_batch","confidence":0.95,"entities":{"volume":120}}
"pH seis ponto sete" → {"intent":"log_ph","confidence":0.95,"entities":{"ph_value":6.7}}

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
  
  // Goodbye
  "tchau": "goodbye",
  "adeus": "goodbye",
  "encerrar": "goodbye",
  "sair": "goodbye",
  "fechar": "goodbye",
};

function trySimpleFallback(text: string): InterpretedCommand | null {
  const normalized = text.toLowerCase().trim();
  
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
    
    const validIntents = ["status", "start_batch", "advance", "log_ph", "log_time", "log_temperature", "pause", "resume", "instructions", "help", "goodbye", "timer", "query_input", "unknown"];
    if (!parsed.intent || !validIntents.includes(parsed.intent)) {
      return { intent: "unknown", confidence: 0.0, entities: {} };
    }

    const cleanEntities: InterpretedCommand["entities"] = {};
    if (parsed.entities) {
      if (typeof parsed.entities.volume === "number") cleanEntities.volume = parsed.entities.volume;
      if (typeof parsed.entities.milk_temperature === "number") cleanEntities.milk_temperature = parsed.entities.milk_temperature;
      if (typeof parsed.entities.ph_value === "number") cleanEntities.ph_value = parsed.entities.ph_value;
      if (typeof parsed.entities.time_value === "string") cleanEntities.time_value = parsed.entities.time_value;
      if (parsed.entities.time_type && ["flocculation", "cut", "press"].includes(parsed.entities.time_type)) {
        cleanEntities.time_type = parsed.entities.time_type;
      }
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
