export const FEED_CONFIG = {
  githubRepos: [
    "microsoft/autogen",
    "microsoft/semantic-kernel",
    "vercel/ai",
    "vllm-project/vllm",
    "modelcontextprotocol/servers",
    "ollama/ollama"
  ],
  blogFeeds: [
    "https://openai.com/news/rss.xml",
    "https://blog.research.google/atom.xml",
    "https://blog.google/products-and-platforms/products/gemini/rss/",
    "https://github.blog/feed/",
    "https://github.blog/category/ai-and-ml/github-copilot/feed/",
    "https://engineering.fb.com/category/ml-applications/feed/",
    "https://blogs.nvidia.com/feed/",
    "https://blog.cloudflare.com/tag/ai/",
    "https://devblogs.microsoft.com/engineering-at-microsoft/feed/",
    "https://raw.githubusercontent.com/Olshansk/rss-feeds/main/feeds/feed_anthropic.xml"
  ]
} as const;

export function normalizeFeedUrl(url: string): string {
  const trimmed = url.trim();
  if (
    trimmed === "https://blog.cloudflare.com/tag/ai/" ||
    trimmed === "https://blog.cloudflare.com/tag/ai"
  ) {
    return "https://blog.cloudflare.com/tag/ai/rss/";
  }
  return trimmed;
}
