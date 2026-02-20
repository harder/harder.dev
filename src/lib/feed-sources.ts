import type { FeedRawItem } from "@/lib/feed-types";
import { FEED_CONFIG, normalizeFeedUrl } from "../../shared/feed-config";

const GITHUB_REPOS = [...FEED_CONFIG.githubRepos];
const RSS_FEEDS = [...FEED_CONFIG.blogFeeds];

const RELEVANCE_KEYWORDS = [
  "ai",
  "agent",
  "llm",
  "model",
  "inference",
  "observability",
  "telemetry",
  "backend",
  "api",
  "runtime",
  "deploy",
  "cloud",
  "security",
  "architecture",
  "engineering",
  "developer",
  "typescript",
  "javascript",
  "python",
  "release",
  "dotnet",
  ".net",
  "c#",
  "f#",
  "asp.net",
  "aspnet",
  "azure",
  "microsoft",
  "visual studio",
  "vs code",
  "nuget",
  "entity framework",
  "ef core",
  "blazor",
  "maui",
  "xaml",
  "winui",
  "wpf",
  "signalr",
  "minimal api",
  "web api",
  "kestrel",
  "azure functions",
  "app service",
  "azure container apps",
  "aks",
  "kubernetes",
  "docker",
  "helm",
  "microservices",
  "distributed systems",
  "distributed tracing",
  "opentelemetry",
  "sre",
  "devops",
  "ci/cd",
  "github actions",
  "gitops",
  "platform engineering",
  "reliability",
  "performance",
  "latency",
  "throughput",
  "scalability",
  "resilience",
  "fault tolerance",
  "incident",
  "postmortem",
  "secure by default",
  "threat modeling",
  "identity",
  "entra",
  "oauth",
  "zero trust",
  "data engineering",
  "vector database",
  "rag",
  "prompt engineering",
  "evaluation",
  "benchmark",
  "inference optimization",
  "quantization",
  "fine-tuning",
  "tool calling",
  "multi-agent",
  "orchestration",
  "sdk",
  "api management",
  "message queue",
  "event-driven",
  "event sourcing",
  "postgres",
  "sql server",
  "cosmos db",
  "redis",
  "cache",
  "grpc",
  "rest",
  "graphql",
  "webassembly",
  "edge",
  "serverless"
];

type FeedOptions = {
  workerBaseUrl?: string;
  maxItems?: number;
};

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function toSourceLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "unknown-source";
  }
}

async function fetchWithRetry(
  input: RequestInfo | URL,
  init: RequestInit = {},
  maxAttempts = 3
): Promise<Response> {
  let attempt = 0;
  let lastError: unknown;

  while (attempt < maxAttempts) {
    try {
      const response = await fetch(input, init);
      if (response.ok || (response.status < 500 && response.status !== 429)) return response;

      const retryAfterHeader = response.headers.get("retry-after");
      const retryAfterMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : 0;
      const delayMs = retryAfterMs || Math.min(1500 * 2 ** attempt, 7000);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      attempt += 1;
      continue;
    } catch (error) {
      lastError = error;
      const delayMs = Math.min(900 * 2 ** attempt, 5000);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      attempt += 1;
    }
  }

  throw lastError ?? new Error("Request failed after retries");
}

async function fetchWorkerItems(workerBaseUrl: string, endpoint: string): Promise<FeedRawItem[]> {
  const response = await fetchWithRetry(`${stripTrailingSlash(workerBaseUrl)}${endpoint}`);
  if (!response.ok) {
    throw new Error(`Worker feed endpoint failed (${response.status})`);
  }
  const payload = (await response.json()) as { items?: FeedRawItem[] };
  return Array.isArray(payload.items) ? payload.items : [];
}

async function fetchGithubFallback(maxPerRepo = 1): Promise<FeedRawItem[]> {
  const rows = await Promise.all(
    GITHUB_REPOS.map(async (repoSlug) => {
      const response = await fetchWithRetry(
        `https://api.github.com/repos/${repoSlug}/releases?per_page=${maxPerRepo}`,
        {
          headers: { Accept: "application/vnd.github+json" }
        }
      );

      if (!response.ok) return [];
      const releases = (await response.json()) as Array<{
        id: number;
        name: string | null;
        tag_name: string;
        html_url: string;
        body: string | null;
        published_at: string;
      }>;

      return releases.map((release) => ({
        id: `gh-${repoSlug}-${release.id}`,
        title: `${repoSlug}: ${release.name || release.tag_name}`,
        content: release.body || release.tag_name,
        url: release.html_url,
        source: `github.com/${repoSlug}`,
        publishedAt: release.published_at,
        kind: "github-release" as const
      }));
    })
  );
  return rows.flat();
}

function parseRssXml(xmlText: string, feedUrl: string): FeedRawItem[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, "application/xml");
  const hasParseError = doc.querySelector("parsererror");
  if (hasParseError) return [];

  const items: FeedRawItem[] = [];
  const rssItems = Array.from(doc.querySelectorAll("item"));
  const atomEntries = Array.from(doc.querySelectorAll("entry"));

  rssItems.forEach((node, index) => {
    const title = node.querySelector("title")?.textContent?.trim() ?? "Untitled";
    const url = node.querySelector("link")?.textContent?.trim() ?? feedUrl;
    const content =
      node.querySelector("description")?.textContent?.trim() ??
      node.querySelector("content\\:encoded")?.textContent?.trim() ??
      "";
    const publishedAt = node.querySelector("pubDate")?.textContent?.trim();
    items.push({
      id: `rss-${toSourceLabel(feedUrl)}-${index}-${title.slice(0, 24)}`,
      title,
      content,
      url,
      source: toSourceLabel(feedUrl),
      publishedAt,
      kind: "blog-post"
    });
  });

  atomEntries.forEach((node, index) => {
    const title = node.querySelector("title")?.textContent?.trim() ?? "Untitled";
    const url = node.querySelector("link")?.getAttribute("href")?.trim() ?? feedUrl;
    const content =
      node.querySelector("summary")?.textContent?.trim() ??
      node.querySelector("content")?.textContent?.trim() ??
      "";
    const publishedAt =
      node.querySelector("updated")?.textContent?.trim() ??
      node.querySelector("published")?.textContent?.trim();
    items.push({
      id: `atom-${toSourceLabel(feedUrl)}-${index}-${title.slice(0, 24)}`,
      title,
      content,
      url,
      source: toSourceLabel(feedUrl),
      publishedAt,
      kind: "blog-post"
    });
  });

  return items;
}

async function fetchRssFallback(): Promise<FeedRawItem[]> {
  const rows = await Promise.all(
    RSS_FEEDS.map(async (feedUrl) => {
      const normalizedUrl = normalizeFeedUrl(feedUrl);
      try {
        const proxied = `https://corsproxy.io/?${encodeURIComponent(normalizedUrl)}`;
        const response = await fetchWithRetry(proxied);
        if (!response.ok) return [];
        const xmlText = await response.text();
        return parseRssXml(xmlText, normalizedUrl).slice(0, 4);
      } catch (error) {
        console.warn(`RSS fallback fetch failed for ${normalizedUrl}`, error);
        return [];
      }
    })
  );
  return rows.flat();
}

function normalizeAndSort(items: FeedRawItem[], maxItems: number): FeedRawItem[] {
  const deduped = new Map<string, FeedRawItem>();
  for (const item of items) {
    const key = item.url.trim().toLowerCase();
    if (!key) continue;
    const existing = deduped.get(key);
    if (!existing) {
      deduped.set(key, item);
      continue;
    }

    const existingDate = Date.parse(existing.publishedAt || "");
    const nextDate = Date.parse(item.publishedAt || "");
    if (Number.isFinite(nextDate) && (!Number.isFinite(existingDate) || nextDate > existingDate)) {
      deduped.set(key, item);
    }
  }

  return Array.from(deduped.values())
    .filter((item) => item.title && item.url)
    .filter((item) => isRelevantItem(item))
    .sort((a, b) => Date.parse(b.publishedAt || "") - Date.parse(a.publishedAt || ""))
    .slice(0, maxItems);
}

function isRelevantItem(item: FeedRawItem): boolean {
  if (item.kind === "github-release") return true;
  const text = `${item.title} ${item.content}`.toLowerCase();
  return RELEVANCE_KEYWORDS.some((keyword) => text.includes(keyword));
}

export async function fetchPublicContentFeeds(options: FeedOptions = {}): Promise<FeedRawItem[]> {
  const workerBaseUrl = options.workerBaseUrl?.trim();
  const maxItems = options.maxItems ?? 12;

  try {
    if (workerBaseUrl) {
      const [githubItems, rssItems] = await Promise.all([
        fetchWorkerItems(
          workerBaseUrl,
          `/github-releases?repos=${encodeURIComponent(GITHUB_REPOS.join(","))}`
        ),
        fetchWorkerItems(
          workerBaseUrl,
          `/rss-feed?urls=${encodeURIComponent(RSS_FEEDS.map((url) => normalizeFeedUrl(url)).join(","))}`
        )
      ]);
      return normalizeAndSort([...githubItems, ...rssItems], maxItems);
    }
  } catch (error) {
    console.warn(
      "Worker feed endpoints failed. Falling back to client-side public sources.",
      error
    );
  }

  const [githubResult, rssResult] = await Promise.allSettled([
    fetchGithubFallback(1),
    fetchRssFallback()
  ]);

  const githubFallback = githubResult.status === "fulfilled" ? githubResult.value : [];
  const rssFallback = rssResult.status === "fulfilled" ? rssResult.value : [];

  if (githubResult.status === "rejected") {
    console.warn("GitHub fallback fetch failed.", githubResult.reason);
  }
  if (rssResult.status === "rejected") {
    console.warn("RSS fallback fetch failed.", rssResult.reason);
  }

  return normalizeAndSort([...githubFallback, ...rssFallback], maxItems);
}
