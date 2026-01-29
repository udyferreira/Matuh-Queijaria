# Matuh Queijaria - Artisan Cheese Production Agent

## Overview

Matuh Queijaria is a backend-driven production management system for artisan cheese making, featuring voice control via Alexa integration. The application tracks cheese production batches through a canonical 20-stage recipe, managing timers, measurements (pH, temperature), and calculated ingredient proportions. The system follows a deterministic architecture where the backend maintains strict control over the production process, with LLM integration serving only as a cognitive assistant for natural language interpretation and guidance—never as a process executor.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
- **Framework**: React 18 with TypeScript
- **Routing**: Wouter (lightweight client-side routing)
- **State Management**: TanStack React Query for server state with automatic polling (5s dashboard, 2s active batch, 1s timers)
- **UI Components**: shadcn/ui component library with Radix UI primitives
- **Styling**: Tailwind CSS with custom dark theme optimized for production environments
- **Animations**: Framer Motion for stage transitions
- **Build Tool**: Vite with custom path aliases (@/, @shared/, @assets/)

### Backend Architecture
- **Runtime**: Node.js with Express
- **Language**: TypeScript (ES Modules)
- **API Design**: RESTful endpoints with Zod validation for request/response schemas
- **Recipe Engine**: YAML-based canonical recipe (v1.0) loaded at startup, immutable during runtime
- **Process Control**: Deterministic stage progression with backend-enforced validations

### Key Architectural Decisions

1. **Deterministic Process Control**
   - Problem: Ensuring food safety and quality requires strict adherence to production steps
   - Solution: Backend is sovereign over stage order, calculations, timers, and validations
   - The LLM cannot calculate proportions, advance/skip stages, alter timers, or override human measurements

2. **LLM as Supervised Assistant**
   - Problem: Natural language interaction needed without compromising process integrity
   - Solution: Tool-calling pattern where LLM suggests intents, backend decides and executes
   - LLM used for: interpreting ambiguous input, explaining steps, reinforcing safety, verbal alerts

3. **Real-time State Polling**
   - Problem: Production requires up-to-date timer and status information
   - Solution: Graduated polling intervals based on data criticality (1s-5s)

4. **Monorepo Structure**
   - `/client` - React frontend application
   - `/server` - Express backend with route handlers
   - `/shared` - Database schemas, API contracts, and shared types

### Data Storage
- **Database**: PostgreSQL via Drizzle ORM
- **Session Storage**: connect-pg-simple for production sessions
- **Schema Design**: 
  - `production_batches` - Batch state with JSONB for calculated inputs, measurements, timers, history
  - `batch_logs` - Audit trail of all production actions
  - `conversations` / `messages` - Chat history for LLM assistant

### API Structure
- Typed API contracts in `/shared/routes.ts` with Zod schemas
- Endpoints: `/api/batches` (CRUD + status), `/api/conversations` (chat), `/api/generate-image`
- Error handling with standardized error schemas

## External Dependencies

### AI Services
- **OpenAI API**: Chat completions and image generation via Replit AI Integrations
- **Environment Variables**: `AI_INTEGRATIONS_OPENAI_API_KEY`, `AI_INTEGRATIONS_OPENAI_BASE_URL`

### Database
- **PostgreSQL**: Primary data store
- **Environment Variable**: `DATABASE_URL`

### Voice Integration
- **Amazon Alexa**: Webhook endpoint at `/api/alexa/webhook` for voice commands
- ASK-compliant responses with proper format (version, outputSpeech, shouldEndSession)
- Always returns HTTP 200 (errors communicated via speech)
- Handles LaunchRequest, IntentRequest, SessionEndedRequest

**Speech Renderer Architecture** (`server/speechRenderer.ts`):
- Backend builds structured `SpeechRenderPayload` JSON with all data
- LLM (gpt-4o-mini) ONLY renders JSON to natural speech - never decides, calculates, or invents
- Contexts: status, instructions, advance, help, query_input, error, start_batch, log_time/ph/date
- Payload includes: stage, instructions, doses (value+unit), timers, allowedUtterances, notes
- Builder functions: buildStatusPayload, buildAdvancePayload, buildQueryInputPayload, buildHelpPayload, buildErrorPayload, buildStartBatchPayload, buildLogConfirmationPayload, buildLaunchPayload
- Structured logging: `[llm.render.input]` and `[llm.render.output]` for troubleshooting
- Fallback speech generation when LLM fails

**Stage-Aware Intent Gating (REGRA MESTRA)**:
- Se etapa tem `operator_input_required` pendente:
  - Bloqueia intents que mudam estado (advance, timers)
  - Permite read-only intents (status, instructions, help) com pendingInputReminder injetado
  - O `expected_intent` da etapa sempre permitido
  - AMAZON.HelpIntent, AMAZON.StopIntent, AMAZON.CancelIntent sempre permitidos
- Logging estruturado: `[GATING] stage=X intent=Y pendingInputs=Z expected=W`

**Intents Estruturados por Etapa**:
- **LogTimeIntent** (etapas 6, 7, 14): Registro de horários via AMAZON.TIME
  - timeType → etapa: floculação→6, corte→7, prensa→14
  - Valida currentStageId antes de registrar
  - Normaliza formatos: T15:30, HH:MM, "now", períodos (MO/AF/EV/NI)
- **RegisterPHAndPiecesIntent** (etapa 13): Registro de pH e quantidade de peças
  - Slots: ph_value (AMAZON.NUMBER), pieces_quantity (AMAZON.NUMBER)
  - Só aceito na etapa 13, rejeitado em outras
  - **Intent Misroute Guard**: Se ALL slots vazios/"?", retorna ajuda contextual para etapa atual
- **RegisterChamberEntryDateIntent** (etapa 19): Registro de data de entrada na câmara 2
  - Slot: entry_date (AMAZON.DATE)
  - Só aceito na etapa 19, rejeitado em outras
  - Calcula automaticamente maturationEndDate (90 dias)
  - **Intent Misroute Guard**: Se entry_date vazio/"?", retorna ajuda contextual para etapa atual

**pH Value Normalization** (`normalizePHValue` em batchService.ts):
- ASR voice patterns: "55"→5.5, "66"→6.6 (divide by 10 if >14 and <100)
- Comma decimal: "6,5"→6.5
- Spaced/hyphen: "5 5"→5.5, "6-5"→6.5
- Range validation: 3.5-8.0
- Applied in: startBatch (milk_ph), RegisterPHAndPiecesIntent (ph_value)
- Zod schema in shared/routes.ts also transforms before validation

**ProcessCommandIntent**: Para comandos gerais (status, avançar, ajuda)
  - Bloqueado quando etapa tem inputs pendentes
  - log_time via texto livre bloqueado - redireciona para LogTimeIntent

- **Backend is SOVEREIGN** - LLM only interprets, never executes or validates
- Documentation available at `docs/ALEXA_WEBHOOK.md`

### Stage Validation System
- **Inputs obrigatórios**: validateAdvance verifica operator_input_required da etapa
- **Timers bloqueantes**: Não permite avanço se timer.blocking está ativo
- **Mapeamento de stored_values**: 
  - Etapa 13: ph_value → initial_ph, pieces_quantity
  - Etapa 6: flocculation_time
  - Etapa 7: cut_point_time
  - Etapa 14: press_start_time
  - Etapa 19: chamber_2_entry_date → calcula maturationEndDate (90 dias)
- **Loop etapa 15**: Sai quando pH <= 5.2 OU após 2 horas (2 min em TEST_MODE)
- **UX amigável**: Mensagens claras informando qual input falta e como fornecê-lo

### Key npm Dependencies
- `drizzle-orm` / `drizzle-kit` - Database ORM and migrations
- `openai` - LLM API client
- `js-yaml` - Recipe YAML parsing
- `p-limit` / `p-retry` - Batch processing with rate limiting
- `express-session` / `connect-pg-simple` - Session management