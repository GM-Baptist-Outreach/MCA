# Midwest Christian Academy

This repo holds the MCA Homeschool frontend and the Supabase backend docs, migrations, and Edge Functions.

- **Frontend** lives at the repo root (`src/`, `public/`, Vite + React + TypeScript + Tailwind). It is the AI Studio export for the live project **MCA Homeschool Services**. The frontend source of truth should match AI Studio.
- **Backend** stays in `supabase/` (migrations and Edge Functions), with the build spec in `SPEC.md` and the schema snapshot in `MCA-Supabase-Schema.sql`.

## Requirements

- Node.js 18+ (LTS recommended)
- npm

## Getting started

Install dependencies:

```bash
npm install
```

Run the development server:

```bash
npm run dev
```

## Available scripts

- `npm run dev` - start Vite in development mode
- `npm run build` - create a production build
- `npm run build:dev` - create a development-mode build
- `npm run preview` - preview the production build locally
- `npm run lint` - run ESLint checks
- `npm run test` - run Vitest tests once
- `npm run test:watch` - run Vitest in watch mode

## Lockfile policy

This repository does not track `package-lock.json`. The AI Studio export includes `bun.lock`.
