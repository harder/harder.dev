# Cloudflare Worker (Hybrid Feed + AI)

This Worker provides:

- `POST /summarize` (Workers AI)
- `GET /github-releases` (GitHub releases feed, GraphQL when token exists, REST fallback)
- `GET /rss-feed` (RSS/Atom feed aggregation)
- `GET /proxy` (generic HTTPS feed proxy)

It includes:

- CORS headers for frontend usage
- exponential backoff + retry
- optional KV metadata caching for conditional fetch (`ETag`, `Last-Modified`)
- edge caching via `caches.default`
- trusted host allowlists for RSS/proxy endpoints
- Workers AI model fallback chain (starting with `@cf/meta/llama-3.3-70b-instruct-awq`)

## Deploy

```bash
cd worker
npx wrangler deploy
```

From repository root (useful for CI / Cloudflare dashboard deploy command):

```bash
npm run worker:deploy
```

## Optional bindings

- `AI` binding (required for `/summarize`)
- `GITHUB_TOKEN` secret (optional, enables GitHub GraphQL branch)
- `FEED_CACHE` KV binding (optional, enables persisted conditional metadata)

## Frontend integration

Set this env var in the Astro app:

```bash
PUBLIC_AI_WORKER_URL=https://your-worker.your-subdomain.workers.dev
```

The signals widget automatically uses this endpoint and falls back to public client-side fetching if unavailable.
