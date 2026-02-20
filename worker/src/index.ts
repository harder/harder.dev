import { FEED_CONFIG, normalizeFeedUrl } from "../../shared/feed-config";

type Env = {
  AI?: {
    run: (model: string, input: Record<string, unknown>) => Promise<unknown>;
  };
  FEED_CACHE?: KVNamespace;
  GITHUB_TOKEN?: string;
  ALLOWED_ORIGIN?: string;
};

type RawFeedItem = {
  id: string;
  title: string;
  content: string;
  url: string;
  source: string;
  publishedAt?: string;
  kind: "blog-post" | "github-release";
};

type CachedUpstreamRecord = {
  etag?: string;
  lastModified?: string;
  body: string;
  contentType: string;
  updatedAt: number;
};

const DEFAULT_GITHUB_REPOS = [...FEED_CONFIG.githubRepos];
const DEFAULT_RSS_FEEDS = [...FEED_CONFIG.blogFeeds];

const MODEL_IDS = [
  "@cf/meta/llama-3.3-70b-instruct-awq",
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  "@cf/meta/llama-3.1-8b-instruct-fast"
];
const CACHE_TTL_SECONDS = 60 * 60;
const CONDITIONAL_TTL_SECONDS = 60 * 60 * 6;

const TRUSTED_RSS_HOSTS = new Set(
  DEFAULT_RSS_FEEDS.map((feedUrl) => {
    try {
      return new URL(feedUrl).hostname;
    } catch {
      return "";
    }
  }).filter(Boolean)
);

const TRUSTED_PROXY_HOSTS = new Set([...TRUSTED_RSS_HOSTS, "api.github.com"]);

function corsHeaders(request: Request, env: Env): Headers {
  const origin = request.headers.get("origin");
  const allowedOrigin = env.ALLOWED_ORIGIN && env.ALLOWED_ORIGIN !== "*" ? env.ALLOWED_ORIGIN : "*";
  const responseOrigin =
    allowedOrigin === "*" ? "*" : origin === allowedOrigin ? origin : allowedOrigin;

  return new Headers({
    "access-control-allow-origin": responseOrigin || "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type,if-none-match,if-modified-since",
    "access-control-max-age": "86400",
    vary: "Origin"
  });
}

function withCors(request: Request, env: Env, response: Response): Response {
  const headers = new Headers(response.headers);
  const cors = corsHeaders(request, env);
  cors.forEach((value, key) => headers.set(key, value));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

function jsonResponse(
  request: Request,
  env: Env,
  data: unknown,
  init: ResponseInit = {}
): Response {
  const headers = new Headers(init.headers || {});
  headers.set("content-type", "application/json; charset=utf-8");
  return withCors(
    request,
    env,
    new Response(JSON.stringify(data), {
      ...init,
      headers
    })
  );
}

function textResponse(
  request: Request,
  env: Env,
  body: string,
  contentType: string,
  init: ResponseInit = {}
): Response {
  const headers = new Headers(init.headers || {});
  headers.set("content-type", contentType);
  return withCors(
    request,
    env,
    new Response(body, {
      ...init,
      headers
    })
  );
}

async function sha1Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(input));
  const bytes = Array.from(new Uint8Array(digest));
  return bytes.map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function fetchWithBackoff(
  input: RequestInfo | URL,
  init: RequestInit,
  maxAttempts = 3
): Promise<Response> {
  let attempt = 0;
  let lastError: unknown;

  while (attempt < maxAttempts) {
    try {
      const response = await fetch(input, init);
      if (response.ok || (response.status < 500 && response.status !== 429)) {
        return response;
      }
      const retryAfterSeconds = Number(response.headers.get("retry-after") || "0");
      const delay =
        retryAfterSeconds > 0 ? retryAfterSeconds * 1000 : Math.min(1200 * 2 ** attempt, 5000);
      await new Promise((resolve) => setTimeout(resolve, delay));
      attempt += 1;
    } catch (error) {
      lastError = error;
      const delay = Math.min(900 * 2 ** attempt, 4500);
      await new Promise((resolve) => setTimeout(resolve, delay));
      attempt += 1;
    }
  }

  throw lastError ?? new Error("Failed after retry attempts");
}

async function getCachedUpstreamRecord(
  env: Env,
  key: string
): Promise<CachedUpstreamRecord | null> {
  if (!env.FEED_CACHE) return null;
  const value = await env.FEED_CACHE.get(key);
  if (!value) return null;
  try {
    return JSON.parse(value) as CachedUpstreamRecord;
  } catch {
    return null;
  }
}

async function setCachedUpstreamRecord(
  env: Env,
  key: string,
  record: CachedUpstreamRecord
): Promise<void> {
  if (!env.FEED_CACHE) return;
  await env.FEED_CACHE.put(key, JSON.stringify(record), { expirationTtl: CONDITIONAL_TTL_SECONDS });
}

async function fetchUpstreamWithConditional(url: string, env: Env): Promise<CachedUpstreamRecord> {
  const cacheKey = `upstream:${await sha1Hex(url)}`;
  const cachedRecord = await getCachedUpstreamRecord(env, cacheKey);

  const headers = new Headers();
  if (cachedRecord?.etag) headers.set("if-none-match", cachedRecord.etag);
  if (cachedRecord?.lastModified) headers.set("if-modified-since", cachedRecord.lastModified);

  const response = await fetchWithBackoff(url, { headers });

  if (response.status === 304 && cachedRecord) {
    return cachedRecord;
  }

  if (response.ok) {
    const body = await response.text();
    const nextRecord: CachedUpstreamRecord = {
      body,
      contentType: response.headers.get("content-type") || "text/plain; charset=utf-8",
      etag: response.headers.get("etag") || cachedRecord?.etag,
      lastModified: response.headers.get("last-modified") || cachedRecord?.lastModified,
      updatedAt: Date.now()
    };
    await setCachedUpstreamRecord(env, cacheKey, nextRecord);
    return nextRecord;
  }

  if (cachedRecord) {
    return cachedRecord;
  }

  throw new Error(`Upstream fetch failed for ${url} (${response.status})`);
}

function stripTags(input: string): string {
  return input
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseXmlItems(xml: string, sourceUrl: string): RawFeedItem[] {
  const source = new URL(sourceUrl).hostname.replace(/^www\./, "");
  const items: RawFeedItem[] = [];

  const rssBlocks = xml.match(/<item[\s\S]*?<\/item>/gi) || [];
  rssBlocks.forEach((block, index) => {
    const title = (block.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || "Untitled").trim();
    const link = (block.match(/<link>([\s\S]*?)<\/link>/i)?.[1] || sourceUrl).trim();
    const description =
      block.match(/<description>([\s\S]*?)<\/description>/i)?.[1] ||
      block.match(/<content:encoded>([\s\S]*?)<\/content:encoded>/i)?.[1] ||
      "";
    const publishedAt = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/i)?.[1]?.trim();
    items.push({
      id: `rss-${source}-${index}-${title.slice(0, 24)}`,
      title: stripTags(title),
      content: stripTags(description).slice(0, 2500),
      url: stripTags(link),
      source,
      publishedAt,
      kind: "blog-post"
    });
  });

  const atomBlocks = xml.match(/<entry[\s\S]*?<\/entry>/gi) || [];
  atomBlocks.forEach((block, index) => {
    const title = (block.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "Untitled").trim();
    const link =
      block.match(/<link[^>]*href=["']([^"']+)["'][^>]*>/i)?.[1] ||
      block.match(/<id>([\s\S]*?)<\/id>/i)?.[1] ||
      sourceUrl;
    const summary =
      block.match(/<summary[^>]*>([\s\S]*?)<\/summary>/i)?.[1] ||
      block.match(/<content[^>]*>([\s\S]*?)<\/content>/i)?.[1] ||
      "";
    const publishedAt =
      block.match(/<updated>([\s\S]*?)<\/updated>/i)?.[1]?.trim() ||
      block.match(/<published>([\s\S]*?)<\/published>/i)?.[1]?.trim();

    items.push({
      id: `atom-${source}-${index}-${title.slice(0, 24)}`,
      title: stripTags(title),
      content: stripTags(summary).slice(0, 2500),
      url: stripTags(link),
      source,
      publishedAt,
      kind: "blog-post"
    });
  });

  return items;
}

function parseListParam(value: string | null, defaults: string[]): string[] {
  if (!value) return defaults;
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function isValidGithubRepo(value: string): boolean {
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value);
}

function isTrustedRssUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && TRUSTED_RSS_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

function isTrustedProxyUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && TRUSTED_PROXY_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

async function runWithModelFallback(
  env: Env,
  prompt: string
): Promise<{ model: string; text: string }> {
  let lastError: unknown;

  for (const model of MODEL_IDS) {
    try {
      const result = await env.AI!.run(model, { prompt });
      const text =
        typeof result === "string"
          ? result
          : typeof (result as { response?: unknown })?.response === "string"
            ? ((result as { response?: unknown }).response as string)
            : JSON.stringify(result);

      return { model, text };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError ?? new Error("No Workers AI model produced a response");
}

async function fetchGithubReleases(repos: string[], env: Env): Promise<RawFeedItem[]> {
  if (env.GITHUB_TOKEN) {
    const aliases = repos
      .map((repo, index) => {
        const [owner, name] = repo.split("/");
        return `r${index}: repository(owner: "${owner}", name: "${name}") { releases(first: 1, orderBy: {field: CREATED_AT, direction: DESC}) { nodes { name tagName description publishedAt url } } }`;
      })
      .join("\n");
    const query = `query FeedReleases { ${aliases} }`;

    const response = await fetchWithBackoff("https://api.github.com/graphql", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${env.GITHUB_TOKEN}`
      },
      body: JSON.stringify({ query })
    });

    if (response.ok) {
      const data = (await response.json()) as {
        data?: Record<string, { releases?: { nodes?: Array<Record<string, string | null>> } }>;
      };

      if (data.data) {
        return repos
          .map((repo, index) => {
            const releaseNode = data.data?.[`r${index}`]?.releases?.nodes?.[0];
            if (!releaseNode) return null;
            const title = `${repo}: ${releaseNode.name || releaseNode.tagName || "release"}`;
            return {
              id: `gh-graphql-${repo}`,
              title,
              content: String(releaseNode.description || releaseNode.tagName || ""),
              url: String(releaseNode.url || `https://github.com/${repo}`),
              source: `github.com/${repo}`,
              publishedAt: String(releaseNode.publishedAt || ""),
              kind: "github-release" as const
            };
          })
          .filter(Boolean) as RawFeedItem[];
      }
    }
  }

  const rows = await Promise.all(
    repos.map(async (repo) => {
      try {
        const url = `https://api.github.com/repos/${repo}/releases?per_page=1`;
        const record = await fetchUpstreamWithConditional(url, env);
        const releases = JSON.parse(record.body) as Array<{
          id: number;
          name: string | null;
          tag_name: string;
          html_url: string;
          body: string | null;
          published_at: string;
        }>;
        const release = releases[0];
        if (!release) return null;
        return {
          id: `gh-rest-${repo}-${release.id}`,
          title: `${repo}: ${release.name || release.tag_name}`,
          content: release.body || release.tag_name,
          url: release.html_url,
          source: `github.com/${repo}`,
          publishedAt: release.published_at,
          kind: "github-release" as const
        };
      } catch {
        return null;
      }
    })
  );

  return rows.filter(Boolean) as RawFeedItem[];
}

async function fetchRssFeeds(urls: string[], env: Env): Promise<RawFeedItem[]> {
  const rows = await Promise.all(
    urls.map(async (url) => {
      try {
        const record = await fetchUpstreamWithConditional(url, env);
        return parseXmlItems(record.body, url).slice(0, 4);
      } catch {
        return [];
      }
    })
  );
  return rows.flat();
}

async function cacheEndpointJson(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  keySuffix: string,
  build: () => Promise<unknown>
): Promise<Response> {
  const cache = caches.default;
  const cacheKey = new Request(`${new URL(request.url).origin}/__cache__/${keySuffix}`, {
    method: "GET"
  });
  const cached = await cache.match(cacheKey);
  if (cached) return withCors(request, env, cached);

  const payload = await build();
  const response = jsonResponse(request, env, payload, {
    headers: { "cache-control": `public, s-maxage=${CACHE_TTL_SECONDS}` }
  });
  ctx.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
}

async function handleSummarize(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") {
    return jsonResponse(request, env, { error: "Method not allowed" }, { status: 405 });
  }
  if (!env.AI) {
    return jsonResponse(request, env, { error: "AI binding missing" }, { status: 503 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    prompt?: string;
    title?: string;
    content?: string;
    url?: string;
  };

  const prompt =
    body.prompt ||
    `Analyze this content:
Title: ${body.title || "Untitled"}
Body: ${(body.content || "").slice(0, 6000)}

Return JSON with:
1. "tldr" (1-2 sentences)
2. "importance" (1 sentence)
3. "tags" (Array of 3-4 concise categories)

JSON only.`;

  const result = await runWithModelFallback(env, prompt);

  return jsonResponse(request, env, {
    response: result.text,
    model: result.model,
    provider: "cloudflare-workers-ai"
  });
}

async function handleGithubReleases(
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  const url = new URL(request.url);
  const candidateRepos = parseListParam(url.searchParams.get("repos"), DEFAULT_GITHUB_REPOS)
    .filter(isValidGithubRepo)
    .slice(0, 10);
  const repos = candidateRepos.length > 0 ? candidateRepos : DEFAULT_GITHUB_REPOS;
  const cacheKey = `gh:${repos.join("|")}`;

  return cacheEndpointJson(request, env, ctx, cacheKey, async () => {
    const items = await fetchGithubReleases(repos, env);
    return { items };
  });
}

async function handleRssFeed(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const candidateFeeds = parseListParam(url.searchParams.get("urls"), DEFAULT_RSS_FEEDS)
    .map(normalizeFeedUrl)
    .filter(isTrustedRssUrl)
    .slice(0, 12);
  const feeds = candidateFeeds.length > 0 ? candidateFeeds : DEFAULT_RSS_FEEDS;
  const cacheKey = `rss:${feeds.join("|")}`;

  return cacheEndpointJson(request, env, ctx, cacheKey, async () => {
    const items = await fetchRssFeeds(feeds, env);
    return { items };
  });
}

async function handleProxy(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const upstream = url.searchParams.get("url");
  if (!upstream || !/^https:\/\//i.test(upstream)) {
    return jsonResponse(
      request,
      env,
      { error: "Provide a valid https upstream url" },
      { status: 400 }
    );
  }

  if (!isTrustedProxyUrl(upstream)) {
    return jsonResponse(
      request,
      env,
      { error: "Upstream host is not on the trusted allowlist" },
      { status: 403 }
    );
  }

  const record = await fetchUpstreamWithConditional(upstream, env);
  return textResponse(request, env, record.body, record.contentType, {
    headers: {
      "cache-control": `public, s-maxage=${CACHE_TTL_SECONDS}`,
      etag: record.etag || "",
      "last-modified": record.lastModified || ""
    }
  });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return withCors(request, env, new Response(null, { status: 204 }));
    }

    try {
      if (url.pathname === "/health") {
        return jsonResponse(request, env, { ok: true, now: new Date().toISOString() });
      }
      if (url.pathname === "/summarize") {
        return await handleSummarize(request, env);
      }
      if (url.pathname === "/github-releases") {
        return await handleGithubReleases(request, env, ctx);
      }
      if (url.pathname === "/rss-feed") {
        return await handleRssFeed(request, env, ctx);
      }
      if (url.pathname === "/proxy") {
        return await handleProxy(request, env);
      }

      return jsonResponse(request, env, { error: "Not found" }, { status: 404 });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown worker error";
      return jsonResponse(request, env, { error: message }, { status: 500 });
    }
  }
};
