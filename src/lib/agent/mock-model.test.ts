import { describe, expect, it } from "vitest";
import { nextStep } from "./mock-model";

type Prompt = Parameters<typeof nextStep>[0];
const user = { role: "user", content: [{ type: "text", text: "Get tables" }] };
const result = (toolName: string, value: unknown) => ({
  role: "tool",
  content: [{ type: "tool-result", toolCallId: toolName, toolName, output: { type: "json", value } }],
});
const mandates = result("listMandates", [{ mandateId: "m1" }]);
const options = result("searchProducts", { options: [{ optionId: "o1", vendor: "Uline" }] });

describe("scripted agent", () => {
  it("starts by reading the mandates and searching", () => {
    const s = nextStep([user] as Prompt);
    expect("calls" in s && s.calls.map((c) => c.name)).toEqual(["listMandates", "searchProducts"]);
  });

  it("dry-runs with ids taken from the tool results, never its own prices", () => {
    const s = nextStep([user, mandates, options] as Prompt);
    expect("calls" in s && s.calls[0]).toEqual({ name: "checkPurchase", input: { mandateId: "m1", items: [{ optionId: "o1", quantity: 2 }] } });
  });

  it("proposes after the dry run, then explains the outcome", () => {
    const afterCheck = nextStep([user, mandates, options, result("checkPurchase", { outcome: "allow" })] as Prompt);
    expect("calls" in afterCheck && afterCheck.calls[0].name).toBe("proposePurchase");
    const done = nextStep([user, mandates, options, result("checkPurchase", {}), result("proposePurchase", { outcome: "needs_approval", approvalUrl: "http://x/approve/1" })] as Prompt);
    expect("text" in done && done.text).toContain("needs_approval");
  });
});
