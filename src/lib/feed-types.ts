export type FeedRawItem = {
  id: string;
  title: string;
  content: string;
  url: string;
  source: string;
  publishedAt?: string;
  kind: "blog-post" | "github-release";
};

export type FeedProcessedItem = FeedRawItem & {
  tldr: string;
  importance: string;
  tags: string[];
  provider: "browser-ai" | "apple-intelligence" | "cloudflare-worker" | "fallback";
  processedAt: string;
};
