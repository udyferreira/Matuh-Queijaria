import OpenAI from "openai";

export interface InterpretedCommand {
  intent: "status" | "start_batch" | "advance" | "log_ph" | "log_time" | "pause" | "resume" | "instructions" | "help" | "goodbye" | "timer" | "unknown";
  confidence: number;
  entities: {
    volume?: number | null;
    milk_temperature?: number | null;
    ph_value?: number | null;
    time_value?: string | null;
    time_type?: "flocculation" | "cut" | "press" | null;
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
  "intent": "status | start_batch | advance | log_ph | log_time | pause | resume | instructions | help | goodbye | timer | unknown",
  "confidence": 0.0,
  "entities": {
    "volume": number | null,
    "milk_temperature": number | null,
    "ph_value": number | null,
    "time_value": string | null,
    "time_type": "flocculation" | "cut" | "press" | null
  }
}

Regras de extração:
- volume: litros de leite mencionados (ex: "50 litros" → 50, "cento e vinte" → 120)
- milk_temperature: temperatura do leite em graus (ex: "35 graus" → 35)
- ph_value: valor de pH mencionado (ex: "seis ponto sete" → 6.7, "pH 5.2" → 5.2)
- time_value: horário no formato "HH:MM" (ex: "dez e meia" → "10:30", "às oito" → "08:00")
- time_type: tipo do registro de tempo - floculação, corte ou prensagem

Exemplos de interpretação:

COMANDOS CURTOS (1-2 palavras) - muito comuns via voz:
"status" → {"intent":"status","confidence":0.95,"entities":{}}
"etapa" → {"intent":"status","confidence":0.95,"entities":{}}
"situação" → {"intent":"status","confidence":0.95,"entities":{}}
"avançar" → {"intent":"advance","confidence":0.95,"entities":{}}
"próxima" → {"intent":"advance","confidence":0.95,"entities":{}}
"seguir" → {"intent":"advance","confidence":0.95,"entities":{}}
"ajuda" → {"intent":"help","confidence":0.95,"entities":{}}
"comandos" → {"intent":"help","confidence":0.95,"entities":{}}
"pausar" → {"intent":"pause","confidence":0.95,"entities":{}}
"pausa" → {"intent":"pause","confidence":0.95,"entities":{}}
"continuar" → {"intent":"resume","confidence":0.95,"entities":{}}
"retomar" → {"intent":"resume","confidence":0.95,"entities":{}}
"instruções" → {"intent":"instructions","confidence":0.95,"entities":{}}
"timer" → {"intent":"timer","confidence":0.95,"entities":{}}
"tempo" → {"intent":"timer","confidence":0.95,"entities":{}}
"tchau" → {"intent":"goodbye","confidence":0.95,"entities":{}}
"sair" → {"intent":"goodbye","confidence":0.95,"entities":{}}

COMANDOS COM CONTEXTO:
"qual o status" → {"intent":"status","confidence":0.95,"entities":{}}
"como está o lote" → {"intent":"status","confidence":0.95,"entities":{}}
"próxima etapa" → {"intent":"advance","confidence":0.95,"entities":{}}
"avançar etapa" → {"intent":"advance","confidence":0.95,"entities":{}}
"o que fazer agora" → {"intent":"instructions","confidence":0.85,"entities":{}}
"quanto falta no timer" → {"intent":"timer","confidence":0.95,"entities":{}}
"tempo restante" → {"intent":"timer","confidence":0.9,"entities":{}}

COMANDOS COM ENTIDADES (requerem extração):
"iniciar lote com 120 litros" → {"intent":"start_batch","confidence":0.95,"entities":{"volume":120}}
"começar produção 50 litros leite a 35 graus" → {"intent":"start_batch","confidence":0.9,"entities":{"volume":50,"milk_temperature":35}}
"começar lote 100 litros temperatura 32 pH 6.5" → {"intent":"start_batch","confidence":0.9,"entities":{"volume":100,"milk_temperature":32,"ph_value":6.5}}
"pH seis ponto sete" → {"intent":"log_ph","confidence":0.95,"entities":{"ph_value":6.7}}
"registrar pH 5.2" → {"intent":"log_ph","confidence":0.95,"entities":{"ph_value":5.2}}
"floculação às dez e quinze" → {"intent":"log_time","confidence":0.9,"entities":{"time_value":"10:15","time_type":"flocculation"}}
"hora do corte foi oito e meia" → {"intent":"log_time","confidence":0.9,"entities":{"time_value":"08:30","time_type":"cut"}}

Retorne APENAS o JSON, sem markdown, explicações ou texto adicional.`;
}

// Dicionário de fallback para comandos simples (1-2 palavras)
// Evita chamada ao LLM para palavras-chave conhecidas
const SIMPLE_COMMAND_MAP: Record<string, InterpretedCommand["intent"]> = {
  // Status
  "status": "status",
  "etapa": "status",
  "situação": "status",
  "como está": "status",
  "como estamos": "status",
  
  // Advance
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
  "seguir": "advance",
  "continuar etapa": "advance",
  
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
  
  // Resume
  "continuar": "resume",
  "retomar": "resume",
  "resumir": "resume",
  "despausar": "resume",
  
  // Instructions
  "instruções": "instructions",
  "instrucoes": "instructions",
  "o que fazer": "instructions",
  "o que faço": "instructions",
  "o que faco": "instructions",
  
  // Timer
  "timer": "timer",
  "tempo": "timer",
  "quanto falta": "timer",
  "tempo restante": "timer",
  
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
  
  // Verificar match exato primeiro
  if (SIMPLE_COMMAND_MAP[normalized]) {
    console.log(`Fallback match: "${normalized}" → ${SIMPLE_COMMAND_MAP[normalized]}`);
    return {
      intent: SIMPLE_COMMAND_MAP[normalized],
      confidence: 1.0,
      entities: {}
    };
  }
  
  // Verificar se contém alguma palavra-chave
  for (const [keyword, intent] of Object.entries(SIMPLE_COMMAND_MAP)) {
    if (normalized === keyword || normalized.includes(keyword)) {
      console.log(`Fallback partial match: "${normalized}" contains "${keyword}" → ${intent}`);
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
    
    const validIntents = ["status", "start_batch", "advance", "log_ph", "log_time", "pause", "resume", "instructions", "help", "goodbye", "timer", "unknown"];
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
