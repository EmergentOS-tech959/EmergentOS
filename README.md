# EmergentOS — Secure, Agent-Native Operating System for the C-Suite

A **Personal OS for Leaders** that provides data sovereignty, strategic intelligence, and time optimization through AI-powered workflows.

## 🎯 Vision

EmergentOS delivers three core capabilities:

1. **Data Sovereignty** — Zero-knowledge security with Nightfall DLP before any data touches the LLM
2. **Strategic Intelligence** — Daily briefings synthesized from Gmail, Calendar, and Drive
3. **Time Optimization** — Calendar conflict detection and scheduling recommendations

```
Google Workspace → Nango OAuth → Inngest Orchestration → Nightfall DLP → Supabase → AI Pipelines → Next.js UI
```

## 🛠️ Tech Stack

| Component | Technology |
|-----------|------------|
| Framework | Next.js 16.1 (App Router) |
| Language | TypeScript (Strict Mode) |
| Auth | Clerk (Google OAuth) |
| OAuth Management | Nango |
| Orchestration | Inngest |
| Database | Supabase (PostgreSQL + RLS + pgvector) |
| AI / LLM | Google Gemini |
| Embeddings | OpenAI (text-embedding-ada-002) |
| DLP Security | Nightfall AI |
| UI Components | Shadcn/ui + Tailwind CSS |
| Deployment | Vercel |

## 🚀 Getting Started

### Prerequisites

- Node.js 20+
- npm 10+
- Accounts on: Clerk, Supabase, Nango, Inngest, Google AI Studio, OpenAI, Nightfall

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/EmergentOS-tech959/EmergentOS.git
   cd EmergentOS
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Copy environment variables:
   ```bash
   cp .env.example .env.local
   ```

4. Fill in your API keys in `.env.local` (see [Environment Variables](#-environment-variables))

5. Run Supabase migrations:
   ```bash
   # Copy contents of supabase/migrations/20260115_phase1_schema.sql
   # Paste into Supabase Dashboard → SQL Editor → Run
   ```

6. Run the development server:
   ```bash
   npm run dev
   ```

7. In a separate terminal, run Inngest Dev Server:
   ```bash
   npm run dev:inngest
   ```

8. Open [http://localhost:3000](http://localhost:3000)

## 📁 Project Structure

```
src/
├── app/
│   ├── (auth)/                     # Authentication routes
│   │   ├── sign-in/[[...sign-in]]/
│   │   └── sign-up/[[...sign-up]]/
│   ├── (dashboard)/                # Protected dashboard routes
│   │   ├── layout.tsx              # Dashboard shell with sidebar
│   │   ├── page.tsx                # Main dashboard
│   │   ├── inbox/                  # Unified inbox
│   │   ├── resources/              # Drive context browser
│   │   └── settings/               # User settings
│   ├── (admin)/                    # Admin routes
│   │   └── admin/
│   ├── api/
│   │   ├── inngest/                # Inngest webhook handler
│   │   ├── nango/                  # Nango OAuth webhooks
│   │   ├── integrations/           # Gmail, Calendar, Drive APIs
│   │   ├── ai/                     # Briefing, Chat, Search APIs
│   │   ├── user/                   # User profile APIs
│   │   └── admin/                  # Admin APIs
│   ├── globals.css                 # Global styles (Obsidian theme)
│   └── layout.tsx                  # Root layout
├── components/
│   ├── layout/                     # App shell, sidebar, header
│   ├── dashboard/                  # Dashboard widgets
│   ├── chat/                       # Omni-panel chat interface
│   ├── settings/                   # Settings components
│   ├── integrations/               # OAuth connect buttons
│   └── ui/                         # Shadcn components
├── lib/
│   ├── inngest.ts                  # Inngest client
│   ├── inngest-functions/          # Background job functions
│   ├── supabase-client.ts          # Client-side Supabase
│   ├── supabase-server.ts          # Server-side Supabase
│   ├── nightfall.ts                # DLP integration
│   ├── gemini.ts                   # Gemini LLM client
│   ├── embeddings.ts               # OpenAI embeddings
│   ├── hybrid-search.ts            # RAG search
│   └── utils.ts                    # Utility functions
├── hooks/                          # React hooks
├── types/                          # TypeScript definitions
└── middleware.ts                   # Auth middleware
```

## 🔐 Environment Variables

Create a `.env.local` file with the following variables:

```env
# Vercel
NEXT_PUBLIC_VERCEL_ENV=development

# Supabase
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key

# Clerk Authentication
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=your_clerk_publishable_key
CLERK_SECRET_KEY=your_clerk_secret_key

# Nango OAuth Management
NANGO_SECRET_KEY=your_nango_secret_key
NEXT_PUBLIC_NANGO_PUBLIC_KEY=your_nango_public_key

# Inngest Orchestration
INNGEST_EVENT_KEY=your_inngest_event_key
INNGEST_SIGNING_KEY=your_inngest_signing_key

# AI Services
GEMINI_API_KEY=your_gemini_api_key
OPENAI_API_KEY=your_openai_api_key

# Security
NIGHTFALL_API_KEY=your_nightfall_api_key
```

## 📊 Database Schema

The database includes the following tables:

| Table | Purpose |
|-------|---------|
| `user_profiles` | User preferences and onboarding status |
| `connections` | Integration connection status (Gmail, Calendar, Drive) |
| `sync_status` | Real-time sync progress tracking |
| `emails` | Synced email messages |
| `calendar_events` | Synced calendar events with conflict detection |
| `drive_documents` | Synced Drive document metadata |
| `briefings` | AI-generated daily briefings |
| `chat_messages` | Chat conversation history |
| `embeddings` | Vector embeddings for RAG search (pgvector) |
| `pii_vault` | Tokenized PII storage for security |
| `admin_logs` | System audit logs |

Run migrations from `supabase/migrations/` in the Supabase SQL Editor.

## 🧪 Scripts

```bash
# Development
npm run dev              # Start Next.js dev server
npm run dev:inngest      # Start Inngest dev server

# Build & Production
npm run build            # Build for production
npm run start            # Start production server

# Code Quality
npm run lint             # Run ESLint
npm run typecheck        # Run TypeScript type checking

# Testing
npm run test             # Run unit tests (Vitest)
npm run test:coverage    # Run tests with coverage
npm run test:e2e         # Run E2E tests (Playwright)
```

## 🔒 Security Architecture

All data passes through Nightfall DLP before reaching the LLM or storage:

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   External      │     │   Nightfall     │     │   Internal      │
│   Data Source   │ ──▶ │   DLP Gate      │ ──▶ │   Processing    │
│   (Gmail, etc)  │     │   (Blocking)    │     │   (Supabase)    │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                               │
                               ▼
                        PII Tokenization
                        "John" → [PERSON_001]
```

- **Row Level Security (RLS)** on all tables
- **PII Tokenization** before LLM processing
- **Client-side re-hydration** for display

## 🚢 Deployment

```bash
vercel --prod
```

Ensure all environment variables are configured in Vercel project settings.

## 📝 License

Proprietary - EmergentOS

---

*Phase 1 - January 2026*
