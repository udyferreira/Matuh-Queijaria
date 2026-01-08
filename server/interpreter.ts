import OpenAI from "openai";

export interface InterpretedCommand {
  intent: "status" | "start_batch" | "advance" | "log_ph" | "log_time" | "pause" | "resume" | "instructions" | "help" | "goodbye" | "timer" | "unknown";
  confidence: number;
  entities: {
    volume?: number;
    ph_value?: number;
    time_value?: string;
    time_type?: "flocculation" | "cut" | "press";
  };
}

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

export async function interpretCommand(text: string): Promise<InterpretedCommand> {
  const normalizedText = text.toLowerCase().trim();
  
  if (!normalizedText) {
    return {
      intent: "unknown",
      confidence: 0.0,
      entities: {}
    };
  }

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `Você é um interpretador de comandos de voz para uma queijaria artesanal.
Analise o texto do usuário e retorne APENAS um JSON válido com:
- intent: uma das opções [status, start_batch, advance, log_ph, log_time, pause, resume, instructions, help, goodbye, timer, unknown]
- confidence: número de 0.0 a 1.0 indicando sua confiança
- entities: objeto com dados extraídos (volume, ph_value, time_value, time_type)

Exemplos:
"qual o status" → {"intent":"status","confidence":0.95,"entities":{}}
"iniciar lote com 50 litros" → {"intent":"start_batch","confidence":0.95,"entities":{"volume":50}}
"avançar para próxima etapa" → {"intent":"advance","confidence":0.9,"entities":{}}
"pH cinco ponto dois" → {"intent":"log_ph","confidence":0.9,"entities":{"ph_value":5.2}}
"hora da floculação dez e trinta" → {"intent":"log_time","confidence":0.85,"entities":{"time_value":"10:30","time_type":"flocculation"}}
"pausar" → {"intent":"pause","confidence":0.95,"entities":{}}
"retomar" → {"intent":"resume","confidence":0.95,"entities":{}}
"instruções" → {"intent":"instructions","confidence":0.9,"entities":{}}
"ajuda" → {"intent":"help","confidence":0.95,"entities":{}}
"tchau" → {"intent":"goodbye","confidence":0.9,"entities":{}}
"quanto falta no timer" → {"intent":"timer","confidence":0.95,"entities":{}}
"quanto tempo falta" → {"intent":"timer","confidence":0.9,"entities":{}}
"falta quanto" → {"intent":"timer","confidence":0.9,"entities":{}}

Retorne APENAS o JSON, sem markdown ou explicações.`
        },
        {
          role: "user",
          content: normalizedText
        }
      ],
      temperature: 0.1,
      max_tokens: 150
    });

    const content = response.choices[0]?.message?.content?.trim();
    if (!content) {
      return { intent: "unknown", confidence: 0.0, entities: {} };
    }

    const parsed = JSON.parse(content) as InterpretedCommand;
    
    if (!parsed.intent || !["status", "start_batch", "advance", "log_ph", "log_time", "pause", "resume", "instructions", "help", "goodbye", "timer", "unknown"].includes(parsed.intent)) {
      return { intent: "unknown", confidence: 0.0, entities: {} };
    }

    return {
      intent: parsed.intent,
      confidence: parsed.confidence ?? 0.5,
      entities: parsed.entities ?? {}
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
