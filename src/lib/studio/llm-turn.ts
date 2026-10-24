/**
 * AG Studio ⇄ AI SDK, the pure part (Day 18). AG Studio ships no LLM adapters: it
 * hands an adapter one turn (conversation items, instructions, tool schemas) and
 * expects output items back. These functions translate that turn for Gemini
 * through the AI SDK, and translate the answer back. The browser runs the tools;
 * the server only asks the model what to call.
 */
import { jsonSchema, tool, type ModelMessage, type ToolChoice, type ToolSet } from "ai";
import type { AgAiConversationItem, AgAiOutputItem, AgAiToolSchema, AgLlmRequest } from "ag-studio";

type AssistantPart = Extract<Extract<ModelMessage, { role: "assistant" }>["content"], unknown[]>[number];
type ToolPart = Extract<Extract<ModelMessage, { role: "tool" }>["content"], unknown[]>[number];

/**
 * Gemini 3 wants each function call's thought signature back on the next turn.
 * Studio keeps a tool call's item id, so the signature rides along in it.
 */
const SIG = "~sig~";
export const callItemId = (callId: string, signature?: string) => (signature ? `fc_${callId}${SIG}${signature}` : `fc_${callId}`);
export const signatureOf = (itemId: string | undefined) => (itemId?.includes(SIG) ? itemId.slice(itemId.indexOf(SIG) + SIG.length) : undefined);

const parseArgs = (s: string) => {
  try {
    const v = JSON.parse(s || "{}");
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
};

export function toModelMessages(input: AgAiConversationItem[]): ModelMessage[] {
  const out: ModelMessage[] = [];
  const names = new Map<string, string>();
  const answered = new Set(input.flatMap((i) => (i.type === "function_call_output" ? [i.callId] : [])));
  const pushAssistant = (part: AssistantPart) => {
    const last = out.at(-1);
    if (last?.role === "assistant" && Array.isArray(last.content)) last.content.push(part);
    else out.push({ role: "assistant", content: [part] });
  };
  const pushTool = (part: ToolPart) => {
    const last = out.at(-1);
    if (last?.role === "tool") last.content.push(part);
    else out.push({ role: "tool", content: [part] });
  };
  const toolResult = (callId: string, output: string): ToolPart => ({ type: "tool-result", toolCallId: callId, toolName: names.get(callId) ?? "tool", output: { type: "text", value: output } });

  for (const item of input) {
    if (item.type === "message" && item.kind === "input") {
      const text = item.content.flatMap((c) => (c.type === "text" ? [c.text] : [])).join("\n");
      if (item.role === "system") {
        if (text) out.push({ role: "system", content: text });
        continue;
      }
      const images = item.content.flatMap((c) => (c.type === "image" && c.imageUrl ? [{ type: "image" as const, image: new URL(c.imageUrl) }] : []));
      out.push({ role: "user", content: [...(text ? [{ type: "text" as const, text }] : []), ...images] });
    } else if (item.type === "message") {
      const text = item.content.map((c) => (c.type === "text" ? c.text : c.refusal)).join("");
      if (text) pushAssistant({ type: "text", text });
    } else if (item.type === "function_call") {
      names.set(item.callId, item.name);
      const signature = signatureOf(item.id);
      pushAssistant({ type: "tool-call", toolCallId: item.callId, toolName: item.name, input: parseArgs(item.arguments), ...(signature ? { providerOptions: { google: { thoughtSignature: signature } } } : {}) });
      // A replayed call can carry its result inline instead of as a separate output item.
      if (item.result !== undefined && !answered.has(item.callId)) pushTool(toolResult(item.callId, item.result));
    } else if (item.type === "function_call_output") {
      pushTool(toolResult(item.callId, item.output));
    }
    // Reasoning items are Studio's display copy of the model's thinking; Gemini doesn't take them back.
  }
  return out;
}

/** Tool schemas only: no execute, so the model proposes calls and the browser runs them. */
export function toToolSet(tools: Pick<AgAiToolSchema, "name" | "description" | "parameters">[] = []): ToolSet {
  return Object.fromEntries(tools.map((t) => [t.name, tool({ description: t.description, inputSchema: jsonSchema(t.parameters as Parameters<typeof jsonSchema>[0]) })]));
}

export function toToolChoice(choice: AgLlmRequest["toolChoice"]): ToolChoice<ToolSet> | undefined {
  if (!choice) return undefined;
  return typeof choice === "string" ? choice : { type: "tool", toolName: choice.name };
}

/** The AI SDK result's content parts, as far as Studio needs them. */
export type ResultPart =
  | { type: "text"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "tool-call"; toolCallId: string; toolName: string; input: unknown; providerMetadata?: { google?: { thoughtSignature?: unknown } } }
  | { type: string };

export function toStudioOutput(parts: ResultPart[], messageId: string): AgAiOutputItem[] {
  const items: AgAiOutputItem[] = [];
  const reasoning = parts.flatMap((p) => (p.type === "reasoning" && "text" in p && p.text ? [p.text] : []));
  if (reasoning.length) items.push({ id: `${messageId}_r`, kind: "output", type: "reasoning", summary: reasoning.map((text) => ({ type: "summary", text })) });
  const text = parts.flatMap((p) => (p.type === "text" && "text" in p ? [p.text] : [])).join("");
  if (text) items.push({ id: messageId, kind: "output", type: "message", role: "assistant", status: "completed", content: [{ type: "text", text, annotations: [] }] });
  for (const p of parts) {
    if (p.type !== "tool-call" || !("toolCallId" in p)) continue;
    const sig = p.providerMetadata?.google?.thoughtSignature;
    items.push({ id: callItemId(p.toolCallId, typeof sig === "string" ? sig : undefined), kind: "output", type: "function_call", callId: p.toolCallId, name: p.toolName, arguments: JSON.stringify(p.input ?? {}), status: "completed" });
  }
  return items;
}
