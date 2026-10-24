/**
 * A scripted stand-in for Gemini, used only when AI_MOCK=true (CI and the
 * Playwright smoke test, where there is no API key and no quota to spend).
 * It follows the same path a real run takes: read the mandates, search,
 * dry-run, propose. It reads ids and prices from the tool results, so prices
 * still come from stored data and the mandate engine still decides.
 */
import type { LanguageModelV3, LanguageModelV3CallOptions } from "@ai-sdk/provider";

type StreamPart = Awaited<ReturnType<LanguageModelV3["doStream"]>>["stream"] extends ReadableStream<infer P> ? P : never;

type Json = Record<string, unknown>;
const usage = {
  inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 0, text: 0, reasoning: 0 },
};

/** Tool results seen so far in the prompt, by tool name (latest wins). */
export function toolResults(prompt: LanguageModelV3CallOptions["prompt"]): Record<string, Json> {
  const out: Record<string, Json> = {};
  for (const m of prompt) {
    if (m.role !== "tool") continue;
    for (const part of m.content) {
      if (part.type !== "tool-result") continue;
      const o = part.output as { type: string; value: unknown };
      const value = o.type === "text" && typeof o.value === "string" ? safeParse(o.value) : o.value;
      out[part.toolName] = (Array.isArray(value) ? { list: value } : (value as Json)) ?? {};
    }
  }
  return out;
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}

type Step = { calls: { name: string; input: unknown }[] } | { text: string };

/** Pure: decides the next step from what the prompt already contains. */
export function nextStep(prompt: LanguageModelV3CallOptions["prompt"]): Step {
  const seen = toolResults(prompt);
  if (seen.proposePurchase) {
    const p = seen.proposePurchase as { outcome?: string; message?: string; error?: string; approvalUrl?: string | null };
    if (p.error) return { text: `I could not propose that order: ${p.error}` };
    return { text: `I proposed the order. The mandate engine says: ${p.outcome}. ${p.approvalUrl ? `The treasurer can review it at ${p.approvalUrl}.` : ""}` };
  }
  if (seen.checkPurchase) {
    const mandate = firstMandate(seen);
    const option = firstOption(seen);
    if (!mandate || !option) return { text: "I could not find an option that fits." };
    return {
      calls: [
        {
          name: "proposePurchase",
          input: {
            mandateId: mandate.mandateId,
            items: [line(option, mandate)],
            consideredOptionIds: [option.optionId],
            rationale: `Cheapest suitable option per unit from ${option.vendor}, per policy 3.3.`,
          },
        },
      ],
    };
  }
  if (seen.searchProducts) {
    const mandate = firstMandate(seen);
    const option = firstOption(seen);
    if (!mandate || !option) return { text: "I could not find any products for that request." };
    return { calls: [{ name: "checkPurchase", input: { mandateId: mandate.mandateId, items: [line(option, mandate)] } }] };
  }
  return { calls: [{ name: "listMandates", input: {} }, { name: "searchProducts", input: { query: "folding tables" } }] };
}

function firstMandate(seen: Record<string, Json>): { mandateId: string; categories: string[] } | null {
  const m = (seen.listMandates as { list?: { mandateId?: string; categories?: string[] }[] } | undefined)?.list?.[0];
  return m?.mandateId ? { mandateId: m.mandateId, categories: m.categories ?? [] } : null;
}

/** One order line in the tools' input shape (OrderInput): 2 listings, filed under the mandate's first category. */
const line = (option: { optionId: string }, mandate: { categories: string[] }) => ({ optionId: option.optionId, listings: 2, category: mandate.categories[0] ?? "supplies" });
function firstOption(seen: Record<string, Json>): { optionId: string; vendor: string } | null {
  const options = (seen.searchProducts as { options?: { optionId: string; vendor: string }[] } | undefined)?.options;
  return options?.[0] ?? null;
}

export function mockModel(): LanguageModelV3 {
  return {
    specificationVersion: "v3",
    provider: "quartermaster-mock",
    modelId: "scripted-agent",
    supportedUrls: {},
    async doGenerate() {
      throw new Error("The scripted model only streams");
    },
    async doStream(options) {
      const step = nextStep(options.prompt);
      const parts: StreamPart[] = [{ type: "stream-start", warnings: [] }];
      if ("calls" in step) {
        step.calls.forEach((c, i) => parts.push({ type: "tool-call", toolCallId: `mock-${Date.now()}-${i}`, toolName: c.name, input: JSON.stringify(c.input) }));
        parts.push({ type: "finish", finishReason: { unified: "tool-calls", raw: "tool-calls" }, usage });
      } else {
        parts.push({ type: "text-start", id: "t" }, { type: "text-delta", id: "t", delta: step.text }, { type: "text-end", id: "t" });
        parts.push({ type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage });
      }
      return {
        stream: new ReadableStream<StreamPart>({
          start(controller) {
            for (const p of parts) controller.enqueue(p);
            controller.close();
          },
        }),
      };
    },
  };
}
