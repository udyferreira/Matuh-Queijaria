# Matuh Queijaria - Artisan Cheese Production Agent

## Overview
Matuh Queijaria is a backend-driven production management system for artisan cheese making. It integrates voice control via Alexa to track and manage cheese production batches through a canonical 19-stage recipe. The system handles timers, measurements (pH, temperature), and calculates ingredient proportions. Its primary purpose is to ensure strict adherence to the production process for food safety and quality, with LLM integration serving as a cognitive assistant for natural language interpretation and guidance, not as a process executor. The project aims to streamline cheese production, improve consistency, and provide a user-friendly interface for managing complex recipes.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### Core Principles
- **Deterministic Process Control**: The backend is sovereign over stage order, calculations, timers, and validations to ensure strict adherence to production steps. The LLM cannot alter the production process.
- **LLM as Supervised Assistant**: The LLM functions as a tool-calling pattern assistant for natural language interpretation, explaining steps, reinforcing safety, and providing verbal alerts, without executing process changes.
- **Monorepo Structure**: The project is organized into `/client` (React frontend), `/server` (Express backend), and `/shared` (database schemas, API contracts, shared types) for maintainability.

### Frontend
- **Framework**: React 18 with TypeScript.
- **Routing**: Wouter.
- **State Management**: TanStack React Query for server state with graduated polling intervals (1s-5s) for real-time updates.
- **UI Components**: shadcn/ui with Radix UI.
- **Styling**: Tailwind CSS with a custom dark theme.
- **Animations**: Framer Motion.
- **Authentication**: Session-based authentication with a login page.

### Backend
- **Runtime**: Node.js with Express and TypeScript.
- **API Design**: RESTful endpoints with Zod validation.
- **Recipe Engine**: YAML-based canonical recipe, loaded at startup and immutable during runtime.
- **Security**:
    - **Authentication**: `express-session` with PostgreSQL-backed sessions, bcryptjs for password hashing.
    - **Alexa Webhook Verification**: Validates certificate chain, signing certificate, X.509 certificate, request signature, and timestamp.
    - **Security Headers**: Helmet for various HTTP security headers and CSP in production.
    - **Rate Limiting**: Implemented for various API endpoints.
    - **Error Sanitization**: Generic error messages in production, full details in development.

### Data Storage
- **Database**: PostgreSQL via Drizzle ORM.
- **Schema**: Includes tables for `production_batches` (with JSONB for state, measurements, history), `batch_logs` (audit trail), `users`, `conversations`/`messages` (chat history), and `alexa_webhook_logs`/`web_request_logs` for persistent logging.
- **Logging**: Persistent logging system with 180-day retention and daily purging.

### Alexa Integration
- **Speech Renderer**: Backend builds structured JSON payloads for the LLM to render into natural speech. The LLM only renders, never decides or calculates.
- **Stage-Aware Intent Gating**: Controls which Alexa intents are allowed based on the current production stage and pending inputs, ensuring process integrity.
- **Multi-Turn Interactions**: Guided flows for critical actions like starting a batch or logging specific measurements (e.g., pH and pieces). Stage 13 entry is guided: upon selecting/resuming a batch on stage 13, the system automatically prompts for pH first, then pieces, then auto-advances.
- **Session-Aware Batch Resolution**: `resolveActiveBatch` prioritizes the session's `activeBatchId` over persisted or fallback batches, ensuring continuity across multi-turn flows.
- **Alexa Reminders API**: Automatically schedules native Alexa reminders for stages with wait times, using the Alexa Reminders API.

## External Dependencies

### AI Services
- **OpenAI API**: Used for chat completions and image generation via Replit AI Integrations.

### Database
- **PostgreSQL**: The primary database used for all data storage.

### Voice Integration
- **Amazon Alexa**: Provides voice control via a webhook endpoint (`/api/alexa/webhook`). Handles various Alexa requests (LaunchRequest, IntentRequest, SessionEndedRequest) and includes robust signature verification in production.