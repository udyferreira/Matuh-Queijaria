# Queijo Nete - Artisan Cheese Production Agent

## Overview

Queijo Nete is a backend-driven production management system for artisan cheese making, featuring voice control via Alexa integration. The application tracks cheese production batches through a canonical 20-stage recipe, managing timers, measurements (pH, temperature), and calculated ingredient proportions. The system follows a deterministic architecture where the backend maintains strict control over the production process, with LLM integration serving only as a cognitive assistant for natural language interpretation and guidance—never as a process executor.

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
- Token-based authentication for Alexa skills

### Key npm Dependencies
- `drizzle-orm` / `drizzle-kit` - Database ORM and migrations
- `openai` - LLM API client
- `js-yaml` - Recipe YAML parsing
- `p-limit` / `p-retry` - Batch processing with rate limiting
- `express-session` / `connect-pg-simple` - Session management