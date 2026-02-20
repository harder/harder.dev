import type { FeedRawItem } from "@/lib/feed-types";

type ProcessedFields = {
  tldr: string;
  importance: string;
  tags: string[];
  provider: "browser-ai" | "apple-intelligence" | "cloudflare-worker" | "fallback";
};

type UniversalAIOptions = {
  workerEndpoint?: string;
};

export class UniversalAI {
  private workerEndpoint: string;

  constructor(options: UniversalAIOptions = {}) {
    this.workerEndpoint = options.workerEndpoint ?? "";
  }

  async processContent(item: FeedRawItem): Promise<ProcessedFields> {
    const prompt = this.buildPrompt(item);

    const localResult = await this.tryLocalInference(prompt);
    if (localResult) {
      return this.parseJSON(localResult.text, localResult.provider, item);
    }

    if (this.workerEndpoint) {
      try {
        const edgeResult = await this.tryEdgeInference(prompt, item);
        return this.parseJSON(edgeResult, "cloudflare-worker", item);
      } catch (error) {
        console.warn("Worker summarization failed, using fallback.", error);
      }
    }

    return this.fallbackSummary(item);
  }

  private async tryLocalInference(
    prompt: string
  ): Promise<{ text: string; provider: "browser-ai" | "apple-intelligence" } | null> {
    const browserPromptApiResult = await this.tryBrowserPromptApi(prompt);
    if (browserPromptApiResult) return browserPromptApiResult;

    const appleResult = await this.tryAppleIntelligence(prompt);
    if (appleResult) return appleResult;

    return null;
  }

  private async tryBrowserPromptApi(
    prompt: string
  ): Promise<{ text: string; provider: "browser-ai" } | null> {
    try {
      const globalAny = window as any;
      const languageModelApi = globalAny.LanguageModel ?? globalAny.ai?.languageModel;
      if (!languageModelApi) return null;

      if (typeof languageModelApi.availability === "function") {
        const availability = await languageModelApi.availability();
        if (availability === "unavailable" || availability === "no") return null;
      } else if (typeof languageModelApi.capabilities === "function") {
        const capabilities = await languageModelApi.capabilities();
        if (capabilities?.available === "no") return null;
      }

      if (typeof languageModelApi.create !== "function") return null;
      const session = await languageModelApi.create({
        systemPrompt: "You are a software engineering analyst. Return only JSON."
      });
      const output = await session.prompt(prompt);
      return { text: this.normalizeModelOutput(output), provider: "browser-ai" };
    } catch (error) {
      console.warn("Browser Prompt API not available.", error);
      return null;
    }
  }

  private async tryAppleIntelligence(
    prompt: string
  ): Promise<{ text: string; provider: "apple-intelligence" } | null> {
    try {
      const globalAny = window as any;
      const appleApi =
        globalAny.AppleIntelligence ??
        globalAny.apple?.intelligence ??
        globalAny.webkit?.appleIntelligence ??
        null;

      if (!appleApi || typeof appleApi.summarize !== "function") return null;
      const output = await appleApi.summarize(prompt);
      return { text: this.normalizeModelOutput(output), provider: "apple-intelligence" };
    } catch (error) {
      console.warn("Apple Intelligence web API unavailable.", error);
      return null;
    }
  }

  private async tryEdgeInference(prompt: string, item: FeedRawItem): Promise<string> {
    const response = await fetch(this.workerEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt,
        title: item.title,
        content: item.content,
        url: item.url
      })
    });

    if (!response.ok) {
      throw new Error(`Worker request failed (${response.status})`);
    }

    const data = (await response.json()) as { response?: unknown };
    if (typeof data.response === "string") return data.response;
    return JSON.stringify(data.response ?? data);
  }

  private buildPrompt(item: FeedRawItem): string {
    return `Analyze this content:
Title: ${item.title}
Source: ${item.source}
Body: ${item.content.slice(0, 5000)}

Return a JSON object with:
1. "tldr": (1-2 sentences)
2. "importance": (1 sentence explanation)
3. "tags": (Array of up to 4 short categories like "Observability", "ML Infra", "Backend")

JSON ONLY. NO MARKDOWN.`;
  }

  private parseJSON(
    text: string,
    provider: ProcessedFields["provider"],
    item: FeedRawItem
  ): ProcessedFields {
    try {
      const normalized = text.trim().replace(/```json|```/g, "");
      const candidate = normalized.match(/\{[\s\S]*\}/)?.[0] || normalized;
      const data = JSON.parse(candidate) as {
        tldr?: string;
        importance?: string;
        tags?: string[];
      };

      return {
        tldr: this.cleanSentence(data.tldr, this.buildFeedTldr(item)),
        importance: this.cleanSentence(data.importance, this.buildFeedImportance(item)),
        tags: Array.isArray(data.tags)
          ? data.tags
              .map((tag) => String(tag).trim())
              .filter(Boolean)
              .slice(0, 4)
          : [],
        provider
      };
    } catch {
      return this.fallbackSummary(item);
    }
  }

  private fallbackSummary(item: FeedRawItem): ProcessedFields {
    return {
      tldr: this.buildFeedTldr(item),
      importance: this.buildFeedImportance(item),
      tags: this.deriveFallbackTags(item),
      provider: "fallback"
    };
  }

  private buildFeedTldr(item: FeedRawItem): string {
    const title = this.cleanText(item.title || "New engineering update");
    const content = this.cleanText(item.content || "");
    if (content.length >= 40) {
      const snippet = this.firstSentence(content, 180);
      return `${title}. ${snippet}`;
    }
    return `${title}. Open the full post for details.`;
  }

  private buildFeedImportance(item: FeedRawItem): string {
    const source = item.source || "trusted source";
    return `Published by ${source}; worth a quick skim if this aligns with your current stack or roadmap.`;
  }

  private deriveFallbackTags(item: FeedRawItem): string[] {
    const text = `${item.title} ${item.content}`.toLowerCase();
    const tags: string[] = [];
    if (/(observability|monitor|trace|telemetry)/.test(text)) tags.push("Observability");
    if (/(model|llm|inference|training|agent)/.test(text)) tags.push("ML Infra");
    if (/(api|backend|service|runtime)/.test(text)) tags.push("Backend");
    if (/(security|auth|risk|policy)/.test(text)) tags.push("Security");
    return tags.slice(0, 4);
  }

  private cleanSentence(value: unknown, fallback: string): string {
    if (typeof value !== "string") return fallback;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : fallback;
  }

  private cleanText(value: string): string {
    return value
      .replace(/<[^>]*>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/\s+/g, " ")
      .trim();
  }

  private firstSentence(value: string, maxLength: number): string {
    const sliced = value.slice(0, maxLength);
    const match = sliced.match(/(.+?[.!?])(\s|$)/);
    return (match?.[1] || sliced).trim();
  }

  private normalizeModelOutput(raw: unknown): string {
    if (typeof raw === "string") return raw;
    if (raw && typeof raw === "object") {
      const data = raw as Record<string, unknown>;
      if (typeof data.response === "string") return data.response;
      if (typeof data.output === "string") return data.output;
      if (typeof data.text === "string") return data.text;
    }
    return JSON.stringify(raw);
  }
}

export class UniversalAIWrapper extends UniversalAI {}
