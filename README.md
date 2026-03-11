# harder.dev

This is the repo for [harder.dev](https://harder.dev), the marketing and company site for Harder Labs LLC.

<img src="https://harder.dev/img/logo_128.png" alt="Harder Labs Logo" width="128" align="right" />

The site is intentionally static-first. Most pages ship as plain Astro output, with one selectively hydrated Preact island for the live signals experience.

## Current stack

- Astro 6
- TypeScript
- Preact islands via `@astrojs/preact`
- Astro sitemap integration
- Astro Fonts API for self-hosted Google fonts
- Astro content collections for typed site data
- Cloudflare Worker for feed aggregation and AI summarization

## Architecture

### Static app

The main app is built as static output and deployed from `dist/`.

Key files:

- `astro.config.mjs`
- `src/layouts/BaseLayout.astro`
- `src/styles/global.css`
- `src/components/SiteHeader.astro`
- `src/components/SiteFooter.astro`

Notable Astro 6 architecture choices:

- `ClientRouter` is enabled in the base layout for Astro transitions
- fonts are configured in `astro.config.mjs` and loaded with `<Font />`
- local structured content uses Astro collections instead of inline page arrays
- the site remains static except for the signals island

### Typed content layer

Project/venture metadata is now stored in Astro content collections:

- `src/content.config.ts`
- `src/content/projects/*.json`

This keeps the `projects` page data centralized, schema-validated, and easier to extend.

### Live signals island

Main files:

- `src/components/islands/LiveSignalsWidget.tsx`
- `src/lib/universal-ai.ts`
- `src/lib/feed-sources.ts`
- `shared/feed-config.ts`

Per item output:

1. TL;DR summary
2. Why it matters
3. Tags
4. Source link

Processing order:

1. Try browser AI (`window.ai.languageModel`) when available
2. Try Apple Intelligence bridge if present
3. Fallback to Cloudflare Worker `/summarize`
4. Final fallback heuristic summary

Caching layers:

- client cache in `localStorage` (1 hour)
- Worker edge cache (`caches.default`)
- optional KV metadata for conditional requests (`ETag` / `Last-Modified`)

## Routes

- `/`
- `/projects`
- `/signals`
- `/about`
- `/contact`
- `/privacy`
- `/terms`

## Local development

Node 22+ is required.

Install and run the site:

```bash
npm install
npm run dev
```

Build and preview:

```bash
npm run build
npm run preview
```

## Validation

Run the full repo checks:

```bash
npm run check
```

This runs:

- `astro check` for the Astro app
- `tsc -p worker/tsconfig.json --noEmit` for the Cloudflare Worker

## Worker integration

Set the frontend env var to enable Worker-backed feed fetching and summarization:

```bash
PUBLIC_AI_WORKER_URL=https://your-worker.workers.dev
```

If this variable is missing, the signals widget still works with public client-side fetching where possible.

See `worker/README.md` for Worker endpoints, bindings, and deployment notes.

## Deployment

There are two deployment workflows:

- `.github/workflows/azure-static-web-apps-orange-mushroom-0f2df5110.yml`
- `.github/workflows/deploy-worker.yml`

### Site deploy

Pipeline:

1. Set up Node 22
2. `npm ci`
3. `npm run build`
4. Upload `dist/` to Azure Static Web Apps

Required repo configuration:

- secret: `AZURE_STATIC_WEB_APPS_API_TOKEN_ORANGE_MUSHROOM_0F2DF5110`
- variable: `PUBLIC_AI_WORKER_URL`

### Worker deploy

Pipeline:

1. Set up Node 22
2. `npm run worker:deploy`

Required repo configuration:

- secret: `CLOUDFLARE_API_TOKEN`
- secret: `CLOUDFLARE_ACCOUNT_ID`
