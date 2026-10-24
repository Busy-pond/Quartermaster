import { describe, expect, it } from "vitest";
import type { AgAiConversationItem } from "ag-studio";
import { callItemId, signatureOf, toModelMessages, toStudioOutput, toToolChoice, toToolSet } from "./llm-turn";

const user = (text: string): AgAiConversationItem => ({ id: "u", kind: "input", type: "message", role: "user", status: "completed", content: [{ type: "text", text }] });

describe("toModelMessages", () => {
  it("turns a tool round into an assistant tool call and a tool result, keeping the thought signature", () => {
    const msgs = toModelMessages([
      user("Which events are above 80% of budget?"),
      { id: callItemId("c1", "SIG=="), kind: "output", type: "function_call", callId: "c1", name: "over_budget_share", arguments: '{"thresholdPct":80}' },
      { id: callItemId("c2"), kind: "output", type: "function_call", callId: "c2", name: "view_page", arguments: "" },
      { type: "function_call_output", callId: "c1", output: '{"ok":true}', status: "completed" },
      { type: "function_call_output", callId: "c2", output: "page", status: "completed" },
      { id: "m", kind: "output", type: "message", role: "assistant", status: "completed", content: [{ type: "text", text: "Beach is at 99.9%.", annotations: [] }] },
    ]);
    expect(msgs.map((m) => m.role)).toEqual(["user", "assistant", "tool", "assistant"]);
    expect(msgs[1].content).toEqual([
      { type: "tool-call", toolCallId: "c1", toolName: "over_budget_share", input: { thresholdPct: 80 }, providerOptions: { google: { thoughtSignature: "SIG==" } } },
      { type: "tool-call", toolCallId: "c2", toolName: "view_page", input: {} },
    ]);
    expect(msgs[2].content).toEqual([
      { type: "tool-result", toolCallId: "c1", toolName: "over_budget_share", output: { type: "text", value: '{"ok":true}' } },
      { type: "tool-result", toolCallId: "c2", toolName: "view_page", output: { type: "text", value: "page" } },
    ]);
  });

  it("uses a result stored on a replayed call when there is no separate output item", () => {
    const msgs = toModelMessages([user("hi"), { id: "x", kind: "output", type: "function_call", callId: "c9", name: "view_schema", arguments: "{}", result: "schema" }]);
    expect(msgs.at(-1)).toEqual({ role: "tool", content: [{ type: "tool-result", toolCallId: "c9", toolName: "view_schema", output: { type: "text", value: "schema" } }] });
  });

  it("keeps system input as a system message and drops reasoning", () => {
    const msgs = toModelMessages([
      { id: "s", kind: "input", type: "message", role: "system", status: "completed", content: [{ type: "text", text: "Today is Nov 1" }] },
      { id: "r", kind: "output", type: "reasoning", summary: [{ type: "summary", text: "thinking" }] },
      user("hi"),
    ]);
    expect(msgs).toEqual([
      { role: "system", content: "Today is Nov 1" },
      { role: "user", content: [{ type: "text", text: "hi" }] },
    ]);
  });
});

describe("toStudioOutput", () => {
  it("returns text as one message and each tool call with its signature in the item id", () => {
    const out = toStudioOutput(
      [
        { type: "text", text: "Checking " },
        { type: "text", text: "the ledger." },
        { type: "tool-call", toolCallId: "c1", toolName: "over_budget_share", input: { thresholdPct: 80 }, providerMetadata: { google: { thoughtSignature: "abc/+=" } } },
      ],
      "msg_1",
    );
    expect(out[0]).toMatchObject({ type: "message", content: [{ type: "text", text: "Checking the ledger." }] });
    expect(out[1]).toMatchObject({ type: "function_call", callId: "c1", name: "over_budget_share", arguments: '{"thresholdPct":80}' });
    expect(signatureOf((out[1] as { id: string }).id)).toBe("abc/+=");
  });
  it("has no signature on an unsigned call", () => expect(signatureOf(callItemId("c1"))).toBeUndefined());
});

describe("tools", () => {
  it("declares Studio's tools without execute, so the browser runs them", () => {
    const set = toToolSet([{ name: "view_page", description: "Look at the page", parameters: { type: "object", properties: {} } }]);
    expect(Object.keys(set)).toEqual(["view_page"]);
    expect(set.view_page.execute).toBeUndefined();
  });
  it("maps tool choice", () => {
    expect(toToolChoice("required")).toBe("required");
    expect(toToolChoice({ name: "add_widget" })).toEqual({ type: "tool", toolName: "add_widget" });
    expect(toToolChoice(undefined)).toBeUndefined();
  });
});
