# Documentação do Webhook Alexa - Matuh Queijaria

## Visão Geral

O endpoint `/api/alexa/webhook` implementa a integração com a Alexa Skills Kit (ASK) para controle por voz do sistema de produção de queijos.

## Contrato do Endpoint

### Método HTTP
```
POST /api/alexa/webhook
```

### Headers Relevantes
```
Content-Type: application/json
Accept: application/json
```

### Regra Fundamental
**O endpoint SEMPRE retorna HTTP 200.** Erros são comunicados exclusivamente via fala (`outputSpeech`).

---

## Estrutura do Payload Recebido

A Alexa envia três tipos principais de requisições:

### 1. LaunchRequest (Abertura da Skill)
```json
{
  "version": "1.0",
  "session": {
    "new": true,
    "sessionId": "amzn1.echo-api.session.xxx",
    "application": {
      "applicationId": "amzn1.ask.skill.xxx"
    },
    "user": {
      "userId": "amzn1.ask.account.xxx"
    }
  },
  "request": {
    "type": "LaunchRequest",
    "requestId": "amzn1.echo-api.request.xxx",
    "timestamp": "2026-01-07T20:00:00Z",
    "locale": "pt-BR"
  }
}
```

### 2. IntentRequest (Comando do Usuário)
```json
{
  "version": "1.0",
  "session": { ... },
  "request": {
    "type": "IntentRequest",
    "requestId": "amzn1.echo-api.request.xxx",
    "timestamp": "2026-01-07T20:00:00Z",
    "locale": "pt-BR",
    "intent": {
      "name": "StatusIntent",
      "confirmationStatus": "NONE",
      "slots": {}
    }
  }
}
```

### 3. IntentRequest com Slots (AMAZON.SearchQuery)
```json
{
  "version": "1.0",
  "session": { ... },
  "request": {
    "type": "IntentRequest",
    "requestId": "amzn1.echo-api.request.xxx",
    "timestamp": "2026-01-07T20:00:00Z",
    "locale": "pt-BR",
    "intent": {
      "name": "StartBatchIntent",
      "confirmationStatus": "NONE",
      "slots": {
        "milkVolumeL": {
          "name": "milkVolumeL",
          "value": "120",
          "confirmationStatus": "NONE"
        },
        "cheeseName": {
          "name": "cheeseName",
          "value": "nete",
          "confirmationStatus": "NONE"
        }
      }
    }
  }
}
```

---

## Estrutura da Resposta (Obrigatória)

Todas as respostas DEVEM seguir este formato exato:

```json
{
  "version": "1.0",
  "response": {
    "outputSpeech": {
      "type": "PlainText",
      "text": "Mensagem falada para o usuário"
    },
    "shouldEndSession": false,
    "reprompt": {
      "outputSpeech": {
        "type": "PlainText",
        "text": "Mensagem de reprompt"
      }
    }
  }
}
```

### Campos Obrigatórios
| Campo | Tipo | Descrição |
|-------|------|-----------|
| `version` | string | Sempre "1.0" |
| `response.outputSpeech.type` | string | Sempre "PlainText" |
| `response.outputSpeech.text` | string | Texto a ser falado |
| `response.shouldEndSession` | boolean | Se a sessão deve terminar |

### Campo Opcional
| Campo | Tipo | Descrição |
|-------|------|-----------|
| `response.reprompt.outputSpeech` | object | Mensagem se usuário não responder |

**Importante:** O campo `reprompt` só deve ser incluído quando `shouldEndSession` é `false`. Quando a sessão está encerrando (`shouldEndSession: true`), o `reprompt` deve ser OMITIDO.

---

## Fluxo de Decisão do Webhook

```
┌─────────────────────────────────────────────────────────────────┐
│                    Requisição Alexa                              │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    ┌─────────────────┐
                    │  request.type?  │
                    └─────────────────┘
                              │
          ┌───────────────────┼───────────────────┐
          ▼                   ▼                   ▼
    LaunchRequest      IntentRequest      SessionEndedRequest
          │                   │                   │
          ▼                   ▼                   ▼
    Boas-vindas         intent.name?         "Até logo"
    + reprompt                │              shouldEnd=true
                              │
    ┌─────────────────────────┼─────────────────────────┐
    ▼           ▼             ▼              ▼          ▼
 Status    StartBatch    AdvanceIntent   HelpIntent   default
    │           │             │              │          │
    ▼           ▼             ▼              ▼          ▼
 Buscar     Criar lote    Validar e      Listar     Fallback
 batch      + inputs      avançar       comandos    "Não entendi"
```

---

## Intents Suportados

### Intents Personalizados

| Intent | Descrição | Slots |
|--------|-----------|-------|
| `StartBatchIntent` | Inicia novo lote de produção | `milkVolumeL`, `cheeseName` |
| `StatusIntent` | Consulta status do lote ativo | - |
| `NextStepIntent` | Instruções da etapa atual | - |
| `RepeatStepIntent` | Repete instruções da etapa | - |
| `AdvanceIntent` | Avança para próxima etapa | - |
| `TimerIntent` | Consulta tempo restante do timer | - |
| `LogPHIntent` | Registra medição de pH | `phValue` |
| `LogTimeIntent` | Registra horário | `timeValue`, `timeType` |
| `PauseIntent` | Pausa o lote | - |
| `ResumeIntent` | Retoma lote pausado | - |
| `HelpIntent` | Lista comandos disponíveis | - |
| `FreeQueryIntent` | Comandos livres | `query` (AMAZON.SearchQuery) |

### Intents Padrão Amazon

| Intent | Descrição |
|--------|-----------|
| `AMAZON.HelpIntent` | Ajuda padrão |
| `AMAZON.CancelIntent` | Cancela operação |
| `AMAZON.StopIntent` | Encerra skill |
| `AMAZON.FallbackIntent` | Fallback para comandos não reconhecidos |

---

## Exemplos Completos de Request/Response

### 1. Abertura da Skill

**Request:**
```json
{
  "version": "1.0",
  "request": {
    "type": "LaunchRequest",
    "locale": "pt-BR"
  }
}
```

**Response:**
```json
{
  "version": "1.0",
  "response": {
    "outputSpeech": {
      "type": "PlainText",
      "text": "Bem-vindo à Matuh Queijaria! Você pode iniciar um lote, verificar o status, ou pedir ajuda. O que deseja fazer?"
    },
    "shouldEndSession": false,
    "reprompt": {
      "outputSpeech": {
        "type": "PlainText",
        "text": "Diga 'iniciar lote', 'status', ou 'ajuda'."
      }
    }
  }
}
```

### 2. Comando Válido - Iniciar Lote

**Request:**
```json
{
  "version": "1.0",
  "request": {
    "type": "IntentRequest",
    "intent": {
      "name": "StartBatchIntent",
      "slots": {
        "milkVolumeL": { "value": "100" },
        "cheeseName": { "value": "nete" }
      }
    }
  }
}
```

**Response:**
```json
{
  "version": "1.0",
  "response": {
    "outputSpeech": {
      "type": "PlainText",
      "text": "Lote de Nete iniciado com 100 litros de leite. Para esta produção você vai precisar de: 50 mililitros de fermento LR, 50 mililitros de fermento DX, 40 mililitros de fermento KL, e 5 mililitros de coalho. Aqueça o leite a 32 graus para começar."
    },
    "shouldEndSession": false,
    "reprompt": {
      "outputSpeech": {
        "type": "PlainText",
        "text": "O que mais posso ajudar?"
      }
    }
  }
}
```

### 3. Comando Inválido / Fallback

**Request:**
```json
{
  "version": "1.0",
  "request": {
    "type": "IntentRequest",
    "intent": {
      "name": "AMAZON.FallbackIntent"
    }
  }
}
```

**Response:**
```json
{
  "version": "1.0",
  "response": {
    "outputSpeech": {
      "type": "PlainText",
      "text": "Desculpe, não entendi. Diga 'ajuda' para ver os comandos disponíveis."
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

### 4. Erro Interno (Sempre HTTP 200)

**Response:**
```json
{
  "version": "1.0",
  "response": {
    "outputSpeech": {
      "type": "PlainText",
      "text": "Ocorreu um erro ao processar seu comando. Tente novamente."
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

---

## Testando o Webhook Isoladamente

### Via cURL - LaunchRequest
```bash
curl -X POST http://localhost:5000/api/alexa/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "version": "1.0",
    "request": {
      "type": "LaunchRequest",
      "locale": "pt-BR"
    }
  }'
```

### Via cURL - StatusIntent
```bash
curl -X POST http://localhost:5000/api/alexa/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "version": "1.0",
    "request": {
      "type": "IntentRequest",
      "intent": {
        "name": "StatusIntent",
        "slots": {}
      }
    }
  }'
```

### Via cURL - StartBatchIntent
```bash
curl -X POST http://localhost:5000/api/alexa/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "version": "1.0",
    "request": {
      "type": "IntentRequest",
      "intent": {
        "name": "StartBatchIntent",
        "slots": {
          "milkVolumeL": { "value": "80" },
          "cheeseName": { "value": "nete" }
        }
      }
    }
  }'
```

---

## Restrições de Arquitetura

| Regra | Descrição |
|-------|-----------|
| Backend Soberano | O backend controla todo o processo produtivo |
| Alexa = Interface | A Alexa é apenas interface de voz, não toma decisões |
| Sem LLM Executor | O LLM não executa ações, apenas interpreta e guia |
| HTTP 200 Sempre | Nunca retornar 4xx ou 5xx para a Alexa |
| Erros via Fala | Todos os erros são comunicados via `outputSpeech` |

---

## Checklist de Conformidade

- [x] Todas as respostas usam `buildAlexaResponse()`
- [x] Nunca retorna HTTP diferente de 200
- [x] `LaunchRequest` tratado com boas-vindas
- [x] `SessionEndedRequest` tratado corretamente
- [x] `IntentRequest` processa todos os intents
- [x] `AMAZON.FallbackIntent` fornece fallback seguro
- [x] `AMAZON.HelpIntent` lista comandos
- [x] `AMAZON.StopIntent` encerra sessão
- [x] Slots extraídos corretamente de `intent.slots[name].value`
- [x] Erros de lógica convertidos em fala
- [x] `shouldEndSession` configurado corretamente
- [x] `reprompt` incluído quando sessão permanece aberta
