import { useEffect, useMemo, useState } from "preact/hooks";
import { fetchPublicContentFeeds } from "@/lib/feed-sources";
import type { FeedProcessedItem, FeedRawItem } from "@/lib/feed-types";
import { UniversalAI } from "@/lib/universal-ai";

type Props = {
  maxItems?: number;
  workerBaseUrl?: string;
};

type FeedState = "idle" | "fetching" | "processing" | "ready" | "error";

type CachePayload = {
  timestamp: number;
  items: FeedProcessedItem[];
};

const CACHE_KEY = "harder:hybrid-feed-cache:v3";
const CACHE_TTL_MS = 60 * 60 * 1000;

function readCache(): CachePayload | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachePayload;
    if (!parsed || !Array.isArray(parsed.items) || typeof parsed.timestamp !== "number")
      return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(items: FeedProcessedItem[]): void {
  try {
    const payload: CachePayload = { timestamp: Date.now(), items };
    localStorage.setItem(CACHE_KEY, JSON.stringify(payload));
  } catch {
    // Ignore storage quota failures.
  }
}

async function processWithConcurrency(
  rawItems: FeedRawItem[],
  ai: UniversalAI,
  onProgress: (count: number) => void
): Promise<FeedProcessedItem[]> {
  const concurrency = 2;
  const queue = [...rawItems];
  const output: FeedProcessedItem[] = [];
  let processed = 0;

  async function workerLoop() {
    while (queue.length > 0) {
      const next = queue.shift();
      if (!next) break;

      const aiResult = await ai.processContent(next);
      output.push({
        ...next,
        ...aiResult,
        processedAt: new Date().toISOString()
      });
      processed += 1;
      onProgress(processed);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => workerLoop()));
  return output;
}

export default function LiveSignalsWidget({ maxItems = 10, workerBaseUrl = "" }: Props) {
  const [items, setItems] = useState<FeedProcessedItem[]>([]);
  const [state, setState] = useState<FeedState>("idle");
  const [errorText, setErrorText] = useState("");
  const [progress, setProgress] = useState({ complete: 0, total: 0 });

  useEffect(() => {
    let alive = true;

    async function run() {
      const cached = readCache();
      if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
        setItems(cached.items.slice(0, maxItems));
        setState("ready");
        return;
      }

      setState("fetching");
      setErrorText("");
      try {
        const raw = await fetchPublicContentFeeds({ workerBaseUrl, maxItems: maxItems + 4 });
        const selected = raw.slice(0, maxItems);
        if (!alive) return;

        setState("processing");
        setProgress({ complete: 0, total: selected.length });

        const summarizeEndpoint = workerBaseUrl
          ? `${workerBaseUrl.replace(/\/+$/, "")}/summarize`
          : "";
        const ai = new UniversalAI({ workerEndpoint: summarizeEndpoint });
        const processed = await processWithConcurrency(selected, ai, (count) => {
          if (!alive) return;
          setProgress((prev) => ({ ...prev, complete: count }));
        });
        if (!alive) return;

        const sorted = processed.sort(
          (a, b) =>
            Date.parse(b.publishedAt || b.processedAt) - Date.parse(a.publishedAt || a.processedAt)
        );
        setItems(sorted);
        writeCache(sorted);
        setState("ready");
      } catch (error) {
        if (!alive) return;
        setState("error");
        setErrorText(error instanceof Error ? error.message : "Unknown failure");
      }
    }

    run();
    return () => {
      alive = false;
    };
  }, [maxItems, workerBaseUrl]);

  const hasItems = useMemo(() => items.length > 0, [items.length]);

  return (
    <section class="hybrid-feed">
      {(state === "fetching" || state === "processing") && (
        <div class="feed-status">
          <p>
            {state === "fetching"
              ? "Fetching feed items from trusted sources..."
              : `Processing items with AI (${progress.complete}/${progress.total})...`}
          </p>
        </div>
      )}

      {state === "error" && (
        <p class="empty-state">
          Feed unavailable right now. {errorText ? `Details: ${errorText}` : ""}
        </p>
      )}

      {state === "ready" && !hasItems && (
        <p class="empty-state">No items available right now. Check again soon.</p>
      )}

      {hasItems && (
        <div class="glass-grid">
          {items.map((item) => (
            <article key={item.id} class="glass-card">
              <div class="meta-row">
                <span>{item.source}</span>
                <span>•</span>
                <span>
                  {new Date(item.publishedAt || item.processedAt).toLocaleDateString("en-US")}
                </span>
                <span>•</span>
                <span>{item.provider}</span>
              </div>
              <h3>{item.title}</h3>
              <p class="glass-label">TL;DR</p>
              <p>{item.tldr}</p>
              <p class="glass-label">Why it matters</p>
              <p>{item.importance}</p>
              <div class="tag-row">
                {item.tags.map((tag) => (
                  <span key={`${item.id}-${tag}`} class="chip">
                    {tag}
                  </span>
                ))}
              </div>
              <p>
                <a class="inline-link" href={item.url} target="_blank" rel="noreferrer noopener">
                  Read full post
                </a>
              </p>
              {item.provider === "fallback" && (
                <p style="margin-top:0.45rem;font-size:0.72rem;color:var(--text-muted);">
                  AI summary unavailable for this item. Showing feed-derived text.
                </p>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
