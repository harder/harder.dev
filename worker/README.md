# harder.dev Worker

Trusted feeds are surfaced through an Astro/Preact island in the main site and backed by this Cloudflare Worker when browser-local processing is unavailable or upstream fetching needs help with CORS and caching.

The frontend tries local/browser AI first, then falls back to this Worker for summarization.


## Cloudflare Worker Details (Hybrid Feed + AI)

This Worker provides:

- `POST /summarize` (Workers AI)
- `GET /github-releases` (GitHub releases feed, GraphQL when token exists, REST fallback)
- `GET /rss-feed` (RSS/Atom feed aggregation)
- `GET /proxy` (generic HTTPS feed proxy)

It includes:

- CORS headers for frontend usage
- exponential backoff and retry
- optional KV metadata caching for conditional fetch (`ETag`, `Last-Modified`)
- edge caching via `caches.default`
- trusted host allowlists for RSS/proxy endpoints
- Workers AI model fallback chain (starting with `@cf/meta/llama-3.3-70b-instruct-awq`)
- shared feed configuration imported from `../shared/feed-config.ts`
- standalone type-checking through `worker/tsconfig.json`

## Local validation

From the repository root:

```bash
npm run check:worker
```

This runs:

```bash
tsc -p worker/tsconfig.json --noEmit
```

Node 22+ is required in the repository root because the main Astro app now targets Astro 6.

### Deploy

```bash
cd worker
npx wrangler deploy
```

From repository root (useful for CI / Cloudflare dashboard deploy command):

```bash
npm run worker:deploy
```

### Optional bindings

- `AI` binding (required for `/summarize`)
- `GITHUB_TOKEN` secret (optional, enables GitHub GraphQL branch)
- `FEED_CACHE` KV binding (optional, enables persisted conditional metadata)

### Frontend integration

Set this env var in the Astro app:

```bash
PUBLIC_AI_WORKER_URL=https://your-worker.your-subdomain.workers.dev
```

The signals widget automatically uses this endpoint and falls back to public client-side fetching if unavailable.

## Related app files

- `src/components/islands/LiveSignalsWidget.tsx`
- `src/lib/feed-sources.ts`
- `src/lib/universal-ai.ts`
- `shared/feed-config.ts`
