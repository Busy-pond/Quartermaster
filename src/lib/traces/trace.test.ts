import { describe, expect, it } from "vitest";
import { eventDoc, signalOf, toolOutcome, withTraces, type ToolTrace } from "./trace";

describe("toolOutcome", () => {
  it("reads the engine's outcome, a returned error, or ok", () => {
    expect(toolOutcome({ outcome: "deny", clause: "M7" })).toBe("deny");
    expect(toolOutcome({ outcome: "needs_approval" })).toBe("needs_approval");
    expect(toolOutcome({ error: "Unknown optionId" })).toBe("rejected");
    expect(toolOutcome({ options: [] })).toBe("ok");
    expect(toolOutcome([1, 2])).toBe("ok");
    expect(toolOutcome(undefined)).toBe("ok");
  });
});

describe("withTraces", () => {
  const fakeClock = () => {
    let t = 0;
    return () => (t += 40);
  };

  it("records the tool, latency and outcome, and returns the result unchanged", async () => {
    const seen: ToolTrace[] = [];
    const tools = withTraces({ checkPurchase: { description: "x", execute: async (_: { a: number }) => ({ outcome: "deny" as const }) } }, (t) => seen.push(t), fakeClock());
    expect(await tools.checkPurchase.execute({ a: 1 })).toEqual({ outcome: "deny" });
    expect(tools.checkPurchase.description).toBe("x");
    expect(seen).toEqual([{ tool: "checkPurchase", latencyMs: 40, outcome: "deny" }]);
  });

  it("records a throw as error and rethrows it", async () => {
    const seen: ToolTrace[] = [];
    const tools = withTraces({ searchProducts: { execute: async () => { throw new Error("Channel3 down"); } } }, (t) => seen.push(t), fakeClock());
    await expect(tools.searchProducts.execute()).rejects.toThrow("Channel3 down");
    expect(seen[0]).toMatchObject({ tool: "searchProducts", outcome: "error", error: "Channel3 down" });
  });

  it("never lets a failing recorder break the tool", async () => {
    const tools = withTraces(
      { a: { execute: async () => 1 }, b: { execute: async () => 2 } },
      (t) => {
        if (t.tool === "a") throw new Error("sync fail");
        return Promise.reject(new Error("async fail"));
      },
    );
    expect(await tools.a.execute()).toBe(1);
    expect(await tools.b.execute()).toBe(2);
  });
});

describe("signals", () => {
  it("counts denied dry runs and proposals, blocks at pay time, and refunds", () => {
    expect(signalOf("agent.tool", { tool: "checkPurchase", outcome: "deny" })).toBe("blocked");
    expect(signalOf("agent.tool", { tool: "proposePurchase", outcome: "deny" })).toBe("blocked");
    expect(signalOf("agent.tool", { tool: "proposePurchase", outcome: "allow" })).toBeNull();
    expect(signalOf("agent.tool", { tool: "searchProducts", outcome: "error" })).toBeNull();
    expect(signalOf("payment.blocked", {})).toBe("blocked");
    expect(signalOf("reimbursement.blocked", null)).toBe("blocked");
    expect(signalOf("payment.refund_requested", {})).toBe("refund");
    expect(signalOf("PAYMENT.CAPTURE.REFUNDED", {})).toBe("refund");
    expect(signalOf("payment.captured", {})).toBeNull();
  });

  it("turns an audit row into an Elastic document", () => {
    const doc = eventDoc({
      id: "e1",
      orgId: "o1",
      traceId: "t1",
      paymentId: null,
      actor: "agent",
      type: "agent.tool",
      message: "checkPurchase → deny in 120 ms",
      payload: { tool: "checkPurchase", latencyMs: 120, outcome: "deny", memberId: "m1" },
      createdAt: new Date("2026-10-24T10:00:00Z"),
    });
    expect(doc).toMatchObject({ "@timestamp": "2026-10-24T10:00:00.000Z", event_id: "e1", trace_id: "t1", tool: "checkPurchase", latency_ms: 120, outcome: "deny", signal: "blocked", subject: "m1" });
  });
});
