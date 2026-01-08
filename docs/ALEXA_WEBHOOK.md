# Alexa Webhook - Documentação Técnica

## Visão Geral

O webhook da Alexa para a Matuh Queijaria funciona como um **adaptador de voz puro**. A Alexa é apenas uma interface - TODA decisão de processo é feita no backend canônico.

### Arquitetura

```
Usuário fala → Alexa → ProcessCommandIntent → LLM interpreta → Backend executa → Alexa fala resposta
```

O processamento ocorre em duas etapas:

1. **interpretCommand()** - LLM (OpenAI) analisa o texto livre e retorna um intent canônico
2. **executeIntent()** - Backend valida e executa a ação baseada no intent

#### Contrato do Interpretador (server/interpreter.ts)

```typescript
interface InterpretedCommand {
  intent: "status" | "start_batch" | "advance" | "log_ph" | "log_time" | "pause" | "resume" | "instructions" | "help" | "goodbye" | "timer" | "unknown";
  confidence: number;  // 0.0 a 1.0
  entities: {
    volume?: number | null;           // litros de leite
    milk_temperature?: number | null; // temperatura do leite em graus
    ph_value?: number | null;         // valor de pH
    time_value?: string | null;       // horário formato "HH:MM"
    time_type?: "flocculation" | "cut" | "press" | null;
  };
}
```

#### Prompt do LLM

O LLM usa um **system prompt fixo** que define restrições estritas:
- Apenas interpreta texto, nunca executa ações
- Não valida regras de processo nem calcula proporções
- Não assume dados não ditos nem infere valores ausentes
- Sempre retorna JSON válido seguindo o schema

O **user prompt** inclui exemplos de extração para valores falados em português:
- "cento e vinte litros" → volume: 120
- "seis ponto sete" → ph_value: 6.7
- "dez e quinze" → time_value: "10:15"

O backend é **SOBERANO** sobre:
- Cálculos de proporções
- Avanço de etapas
- Validações de processo
- Registro de medições

A Alexa **NÃO**:
- Calcula nada
- Decide nada
- Avança etapas
- Interpreta comandos

---

## Modelo de Intents

A skill utiliza dois intents customizados:

| Intent | Descrição |
|--------|-----------|
| `ProcessCommandIntent` | Captura comandos gerais via slot `utterance` (AMAZON.SearchQuery) |
| `LogTimeIntent` | Registro de horários com slots nativos AMAZON.TIME e timeType customizado |

### LogTimeIntent (Recomendado para Horários)

O `LogTimeIntent` usa o slot nativo `AMAZON.TIME` para reconhecimento confiável de horários, evitando interpretações incorretas.

**Slots:**
| Slot | Tipo | Obrigatório | Descrição |
|------|------|-------------|-----------|
| `time` | AMAZON.TIME | Sim | Horário no formato HH:MM |
| `timeType` | TimeTypeSlot (custom) | Não | Tipo do horário (floculação, corte, prensa) |

**Configuração do Interaction Model:**

```json
{
  "name": "LogTimeIntent",
  "slots": [
    {
      "name": "time",
      "type": "AMAZON.TIME"
    },
    {
      "name": "timeType",
      "type": "TimeTypeSlot"
    }
  ],
  "samples": [
    "hora da {timeType} às {time}",
    "horário da {timeType} às {time}",
    "registra hora da {timeType} às {time}",
    "registra horário da {timeType} às {time}",
    "a {timeType} foi às {time}",
    "hora às {time}",
    "registra hora às {time}",
    "às {time}",
    "{time}"
  ]
}
```

**Slot Type customizado (TimeTypeSlot):**

```json
{
  "name": "TimeTypeSlot",
  "values": [
    { "name": { "value": "floculação", "synonyms": ["floculacao", "flocul"] } },
    { "name": { "value": "corte", "synonyms": ["ponto de corte", "ponto"] } },
    { "name": { "value": "prensa", "synonyms": ["início de prensa", "inicio de prensa"] } }
  ]
}
```

**Payload recebido:**
```json
{
  "request": {
    "type": "IntentRequest",
    "intent": {
      "name": "LogTimeIntent",
      "slots": {
        "time": { "value": "15:30" },
        "timeType": { "value": "floculação" }
      }
    }
  }
}
```

O backend mapeia `timeType` para tipos internos:
- "floculação" → `flocculation`
- "corte" / "ponto" → `cut_point`
- "prensa" → `press_start`

**Tratamento de "agora":**
Se o slot `time` contiver "now" ou "agora", o backend converte automaticamente para o horário atual de Brasília (America/Sao_Paulo).

### Intents Amazon Built-in (suportados)

| Intent | Ação |
|--------|------|
| `AMAZON.HelpIntent` | Mostra comandos disponíveis |
| `AMAZON.StopIntent` | Encerra a sessão |
| `AMAZON.CancelIntent` | Encerra a sessão |
| `AMAZON.FallbackIntent` | Resposta para comandos não reconhecidos |

---

## Tipos de Request

### LaunchRequest

Quando o usuário abre a skill: "Alexa, abrir Matuh Queijaria"

**Resposta:**
```json
{
  "version": "1.0",
  "response": {
    "outputSpeech": {
      "type": "PlainText",
      "text": "Bem-vindo à Matuh Queijaria! Diga um comando como 'status' ou 'iniciar lote com 50 litros'."
    },
    "shouldEndSession": false,
    "reprompt": {
      "outputSpeech": {
        "type": "PlainText",
        "text": "Diga 'ajuda' para ver os comandos."
      }
    }
  }
}
```

### IntentRequest com ProcessCommandIntent

**Payload recebido da Alexa:**
```json
{
  "version": "1.0",
  "request": {
    "type": "IntentRequest",
    "intent": {
      "name": "ProcessCommandIntent",
      "slots": {
        "utterance": {
          "name": "utterance",
          "value": "registra pH cinco ponto dois"
        }
      }
    }
  }
}
```

O backend extrai `slots.utterance.value` e interpreta o texto livre.

### SessionEndedRequest

Quando a sessão é encerrada (timeout, erro, usuário fechou).

**Resposta:** HTTP 200 com corpo vazio ou mínimo.

---

## Comandos Suportados

O interpretador de voz do backend reconhece os seguintes padrões:

### Iniciar Lote
- "iniciar lote"
- "começar produção"
- "novo lote"
- "iniciar com 50 litros"

### Status
- "status"
- "como está"
- "qual etapa"
- "situação"

### Timer
- "timer"
- "quanto falta"
- "tempo restante"

### Avançar Etapa
- "avançar"
- "próxima etapa"
- "próximo passo"
- "pronto"

### Registrar pH
- "registra pH 5.2"
- "pH cinco ponto dois"
- "acidez 5.2"

### Registrar Horário
- "hora da floculação 10:30"
- "hora do corte 11:15"
- "hora da prensa 14:00"

### Pausar/Retomar
- "pausar"
- "pausa"
- "retomar"
- "continuar"

### Instruções
- "instruções"
- "o que fazer"
- "como fazer"
- "repetir"

### Ajuda
- "ajuda"
- "comandos"
- "o que posso dizer"

### Encerrar
- "tchau"
- "adeus"
- "sair"

---

## Formato de Resposta

Todas as respostas seguem o formato ASK-compliant:

```json
{
  "version": "1.0",
  "response": {
    "outputSpeech": {
      "type": "PlainText",
      "text": "<texto vindo do backend canônico>"
    },
    "shouldEndSession": false,
    "reprompt": {
      "outputSpeech": {
        "type": "PlainText",
        "text": "<texto de reprompt>"
      }
    }
  }
}
```

### Regras Importantes

1. **reprompt** só é incluído quando `shouldEndSession: false`
2. **Sempre retorna HTTP 200** - erros são comunicados via fala
3. **Nunca retorna JSON interno** - sempre o formato Alexa completo

---

## Testes com cURL

### LaunchRequest
```bash
curl -X POST http://localhost:5000/api/alexa/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "version": "1.0",
    "request": {
      "type": "LaunchRequest"
    }
  }'
```

### ProcessCommandIntent - Status
```bash
curl -X POST http://localhost:5000/api/alexa/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "version": "1.0",
    "request": {
      "type": "IntentRequest",
      "intent": {
        "name": "ProcessCommandIntent",
        "slots": {
          "utterance": {
            "name": "utterance",
            "value": "status do lote"
          }
        }
      }
    }
  }'
```

### ProcessCommandIntent - Registrar pH
```bash
curl -X POST http://localhost:5000/api/alexa/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "version": "1.0",
    "request": {
      "type": "IntentRequest",
      "intent": {
        "name": "ProcessCommandIntent",
        "slots": {
          "utterance": {
            "name": "utterance",
            "value": "registra pH cinco ponto dois"
          }
        }
      }
    }
  }'
```

### ProcessCommandIntent - Iniciar Lote
```bash
curl -X POST http://localhost:5000/api/alexa/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "version": "1.0",
    "request": {
      "type": "IntentRequest",
      "intent": {
        "name": "ProcessCommandIntent",
        "slots": {
          "utterance": {
            "name": "utterance",
            "value": "iniciar lote com 80 litros"
          }
        }
      }
    }
  }'
```

### AMAZON.StopIntent
```bash
curl -X POST http://localhost:5000/api/alexa/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "version": "1.0",
    "request": {
      "type": "IntentRequest",
      "intent": {
        "name": "AMAZON.StopIntent",
        "slots": {}
      }
    }
  }'
```

---

## Critérios de Aceite

O webhook está correto quando:

1. ✅ "Alexa, abrir Matuh Queijaria" funciona
2. ✅ Qualquer frase livre chega no backend via ProcessCommandIntent
3. ✅ Nenhuma lógica de processo existe na Alexa
4. ✅ O backend permanece soberano
5. ✅ O webhook é apenas um adaptador de voz
6. ✅ Sempre retorna HTTP 200
7. ✅ reprompt só aparece quando shouldEndSession é false

---

## Configuração no Alexa Developer Console

### Interaction Model

```json
{
  "interactionModel": {
    "languageModel": {
      "invocationName": "matuh queijaria",
      "intents": [
        {
          "name": "ProcessCommandIntent",
          "slots": [
            {
              "name": "utterance",
              "type": "AMAZON.SearchQuery"
            }
          ],
          "samples": [
            "{utterance}",
            "{utterance} etapa",
            "{utterance} a etapa",
            "{utterance} o lote",
            "{utterance} produção",
            "qual o {utterance}",
            "qual é o {utterance}",
            "qual a {utterance}",
            "quero {utterance}",
            "quero ver {utterance}",
            "me diz o {utterance}",
            "preciso de {utterance}",
            "registrar {utterance}",
            "iniciar {utterance}",
            "começar {utterance}"
          ]
        },
        {
          "name": "AMAZON.HelpIntent",
          "samples": []
        },
        {
          "name": "AMAZON.StopIntent",
          "samples": []
        },
        {
          "name": "AMAZON.CancelIntent",
          "samples": []
        },
        {
          "name": "AMAZON.FallbackIntent",
          "samples": []
        }
      ]
    }
  }
}
```

### Estrutura dos Sample Utterances

**IMPORTANTE:** A estrutura dos samples determina o que vai para o slot `{utterance}`.

#### Problema Comum
Sample `avançar {utterance}` + usuário diz "avançar etapa" = slot recebe "etapa" (perde o verbo!)

#### Solução Correta
Estruturar samples para capturar o **verbo/ação**:

| Sample | Usuário diz | Slot recebe |
|--------|-------------|-------------|
| `{utterance} etapa` | "avançar etapa" | "avançar" |
| `{utterance} a etapa` | "próxima a etapa" | "próxima" |
| `qual o {utterance}` | "qual o status" | "status" |
| `quero {utterance}` | "quero avançar" | "avançar" |

#### Palavras-Chave Reconhecidas pelo Backend

**Status:** status, situação
**Avançar:** avançar, próxima, próximo, concluir, finalizar, prosseguir, seguir
**Instruções:** instrução, instruções, passos, como fazer, o que fazer
**Timer:** timer, tempo, cronômetro, quanto falta
**Pausar:** pausar, pausa, parar
**Continuar:** continuar, retomar, resumir
**Ajuda:** ajuda, socorro, comandos, opções
**Sair:** tchau, adeus, encerrar, sair

### Endpoint

Configure o endpoint como HTTPS apontando para:
```
https://<seu-replit-url>/api/alexa/webhook
```
