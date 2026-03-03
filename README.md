# harder.dev

This is the repo for the [Harder.dev](https://harder.dev) web site.

<img src="https://harder.dev/img/logo_128.png" alt="Harder Labs Logo" width="128" style="float:right; margin: 0 0 1rem 1rem;" />

This web site is the online home of Harder Labs, LLC, an engineering-led product studio and venture laboratory. We build and operate online communities, diverse e-commerce brands, and software experiments. 25+ years of engineering experience, a bias toward shipping fast, and a genuine curiosity about discovering and using the technologies of tomorrow.

## App Stack

- Astro (static output)
- TypeScript
- Preact islands
- Astro sitemap integration

## Local Dev

```bash
npm install
npm run dev
```

Build and preview:

```bash
npm run build
npm run preview
```

## Routes

- `/` home
- `/principles`
- `/signals`
- `/about`
- `/contact`

## Hybrid Feed

Main files:

- `src/components/islands/LiveSignalsWidget.tsx`
- `src/lib/universal-ai.ts`
- `src/lib/feed-sources.ts`

Per item output:

1. TL;DR summary
2. Why it matters
3. Smart tags/categories
4. Link to full item

### Processing order

1. Try browser AI (`window.ai.languageModel`) when available
2. Try Apple Intelligence bridge if present
3. Fallback to Cloudflare Worker `/summarize`
4. Final fallback heuristic summary

### Feed sources

- GitHub releases (selected public repos)
- Trusted RSS/Atom blogs
- Worker-assisted fetching to handle CORS/domain restrictions
- Source allowlists for safer feed ingestion

### Caching

- Client cache in `localStorage` (1 hour)
- Worker edge cache (`caches.default`)
- Optional KV metadata for conditional requests (`ETag`/`Last-Modified`)

## Cloudflare Worker

Worker lives in `worker/`.

Endpoints:

- `POST /summarize`
- `GET /github-releases`
- `GET /rss-feed`
- `GET /proxy`

Worker safeguards:

- Workers AI model fallback chain (tries your requested `llama-3.3-70b-instruct-awq` first)
- host allowlists for RSS/proxy endpoints
- conditional upstream metadata via KV (`ETag` / `Last-Modified`)
- retry/backoff for upstream and GitHub calls

See `worker/README.md` for deployment and bindings.

Set frontend env var to enable Worker integration:

```bash
PUBLIC_AI_WORKER_URL=https://your-worker.workers.dev
```

## Deployment

GitHub Actions workflow:

- `.github/workflows/azure-static-web-apps-delightful-water-0cb5fbc10.yml`

Pipeline:

1. `npm install`
2. `npm run build`
3. Upload `dist/` to Azure Static Web Apps
