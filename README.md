# EmergentOS Phase 0 — Architectural Validation

A "Tracer Bullet" implementation to validate the blocking DLP security architecture for EmergentOS.

## 🎯 Purpose

This Phase 0 sprint validates the critical data flow:

```
Google Account → Clerk Auth → Nango OAuth → Inngest Orchestration → [2s DLP Simulation] → Supabase → Next.js UI
```

**Primary Objective:** Validate the "latency feel" of a blocking DLP security architecture.

## 🛠️ Tech Stack

| Component | Technology |
|-----------|------------|
| Framework | Next.js 14 (App Router) |
| Language | TypeScript (Strict Mode) |
| Auth | Clerk |
| OAuth Management | Nango |
| Orchestration | Inngest |
| Database | Supabase (PostgreSQL + RLS) |
| UI Components | Shadcn/ui + Tailwind CSS |
| Deployment | Vercel |

## 🚀 Getting Started

### Prerequisites

- Node.js 20+
- npm 10+
- Accounts on: Clerk, Supabase, Nango, Inngest

### Installation

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```

3. Copy environment variables:
   ```bash
   cp .env.example .env.local
   ```

4. Fill in your API keys in `.env.local`

5. Run the development server:
   ```bash
   npm run dev
   ```

6. In a separate terminal, run Inngest Dev Server:
   ```bash
   npm run dev:inngest
   ```

7. Open [http://localhost:3000](http://localhost:3000)

## 📁 Project Structure

```
src/
├── app/
│   ├── layout.tsx              # Root layout with Clerk provider
│   ├── page.tsx                # Landing/auth page
│   ├── dashboard/
│   │   └── page.tsx            # Main dashboard with email list
│   ├── api/
│   │   ├── inngest/
│   │   │   └── route.ts        # Inngest webhook handler
│   │   └── nango/
│   │       └── webhook/
│   │           └── route.ts    # Nango connection webhook
│   └── globals.css             # Global styles (dark theme)
├── components/
│   ├── ui/                     # Shadcn components
│   ├── EmailList.tsx           # Email list component
│   ├── SecurityStatus.tsx      # "Securing Data..." indicator
│   ├── ConnectGmail.tsx        # Nango connect button
│   └── Sidebar.tsx             # Minimal sidebar
├── lib/
│   ├── supabase.ts             # Supabase client
│   ├── inngest.ts              # Inngest client
│   └── utils.ts                # Utility functions
└── types/
    └── index.ts                # TypeScript interfaces
```

## 🔐 Environment Variables

See `.env.example` for required variables:

- **Clerk**: Authentication
- **Supabase**: Database with RLS
- **Nango**: OAuth token management for Gmail
- **Inngest**: Workflow orchestration

## 📊 Database Schema

Run this SQL in your Supabase SQL Editor:

```sql
-- See PHASE0_IMPLEMENTATION_PLAN.md for full schema
```

## 🧪 The Core Test

The Inngest function includes a **2-second blocking delay** that simulates Nightfall DLP scanning:

```typescript
await step.sleep('mock-dlp-scan', '2s');
```

This allows Rob to **physically feel** the latency of a blocking security architecture.

## 📺 UI States

| State | Description |
|-------|-------------|
| **A** | Disconnected - Connect Gmail button shown |
| **B** | Fetching/Securing - Loading with "Securing Data..." message |
| **C** | Complete - Email list displayed with security verified badge |

## 🚢 Deployment

```bash
vercel --prod
```

## 📝 License

Proprietary - EmergentOS

---

*Phase 0 Validation Sprint - January 2026*
