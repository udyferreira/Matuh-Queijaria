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
    volume?: number;      // para start_batch
    ph_value?: number;    // para log_ph  
    time_value?: string;  // para log_time (formato "HH:MM")
    time_type?: "flocculation" | "cut" | "press";
  };
}
```

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

A skill utiliza **APENAS UM** intent customizado:

| Intent | Descrição |
|--------|-----------|
| `ProcessCommandIntent` | Captura qualquer frase livre via slot `utterance` (AMAZON.SearchQuery) |

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
            "{utterance}"
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

### Endpoint

Configure o endpoint como HTTPS apontando para:
```
https://<seu-replit-url>/api/alexa/webhook
```
