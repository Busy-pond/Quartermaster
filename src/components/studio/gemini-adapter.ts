/**
 * AG Studio's LLM adapter for our Gemini route (AG Studio ships none). One turn = one
 * POST to /api/studio/llm, which holds the key; the reply's output items are replayed
 * as Studio events. Not streamed token by token: a turn is short, and one JSON reply
 * keeps the route simple and the thought signatures intact.
 */
import type { AgAiEvent, AgLlmAdapter, AgLlmResponse } from "ag-studio";

export function geminiAdapter(endpoint = "/api/studio/llm"): AgLlmAdapter {
  return {
    executeTurn(request, options) {
      const complete: Promise<AgLlmResponse> = fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
        signal: options?.signal,
      }).then(async (res) => {
        const json = await res.json().catch(() => ({}));
        if (!res.ok) return { id: `err_${Date.now()}`, createdAt: Date.now(), status: "failed", output: [], error: { code: String(res.status), message: json.error ?? "The assistant is unavailable" } };
        return json as AgLlmResponse;
      });
      return {
        complete,
        stream: {
          async *[Symbol.asyncIterator](): AsyncIterator<AgAiEvent> {
            const r = await complete;
            for (const item of r.output) {
              if (item.type === "message") {
                yield { type: "TEXT_MESSAGE_START", messageId: item.id, role: "assistant" };
                yield { type: "TEXT_MESSAGE_CONTENT", messageId: item.id, delta: item.content.map((c) => (c.type === "text" ? c.text : c.refusal)).join("") };
                yield { type: "TEXT_MESSAGE_END", messageId: item.id };
              } else if (item.type === "function_call") {
                yield { type: "TOOL_CALL_START", toolCallId: item.callId, toolCallName: item.name };
                yield { type: "TOOL_CALL_ARGS", toolCallId: item.callId, delta: item.arguments };
                yield { type: "TOOL_CALL_END", toolCallId: item.callId };
              } else if (item.type === "reasoning") {
                const text = item.summary.map((s) => s.text).join("\n");
                if (!text) continue;
                yield { type: "REASONING_MESSAGE_START", messageId: item.id, role: "reasoning" };
                yield { type: "REASONING_MESSAGE_CONTENT", messageId: item.id, delta: text };
                yield { type: "REASONING_MESSAGE_END", messageId: item.id };
              }
            }
          },
        },
      };
    },
  };
}
