import { describe, expect, it } from "vitest";
import { ANOMALY_ESQL, detectAnomalies, parseEsql } from "./anomalies";
import type { AuditRow } from "./trace";

const now = new Date("2026-10-24T18:00:00Z");
let n = 0;
const row = (type: string, payload: unknown, at: string, extra: Partial<AuditRow> = {}): AuditRow => ({
  id: `e${++n}`,
  orgId: "o1",
  traceId: `t${n}`,
  paymentId: null,
  actor: "agent",
  type,
  message: "",
  payload,
  createdAt: new Date(at),
  ...extra,
});
const deny = (member: string, at: string, trace?: string) => row("agent.tool", { tool: "checkPurchase", outcome: "deny", memberId: member }, at, trace ? { traceId: trace } : {});

describe("detectAnomalies", () => {
  it("flags a member with 3 blocked attempts in one day, not one with 2", () => {
    const rows = [deny("sam", "2026-10-24T09:00:00Z", "r1"), deny("sam", "2026-10-24T09:01:00Z", "r1"), deny("sam", "2026-10-24T11:00:00Z", "r2"), deny("ana", "2026-10-24T09:00:00Z"), deny("ana", "2026-10-24T10:00:00Z")];
    expect(detectAnomalies(rows, now)).toEqual([{ signal: "blocked", subject: "sam", day: "2026-10-24", count: 3, traces: 2, last: "2026-10-24T11:00:00.000Z" }]);
  });

  it("doesn't add up attempts across days or outside the window", () => {
    const rows = [deny("sam", "2026-10-23T23:59:00Z"), deny("sam", "2026-10-24T00:01:00Z"), deny("sam", "2026-10-24T01:00:00Z"), deny("sam", "2026-10-10T01:00:00Z"), deny("sam", "2026-10-10T02:00:00Z"), deny("sam", "2026-10-10T03:00:00Z")];
    expect(detectAnomalies(rows, now)).toEqual([]);
  });

  it("counts a refund once per payment (app request + PayPal webhook)", () => {
    const refund = (p: string, at: string) => [row("payment.refund_requested", {}, at, { paymentId: p, traceId: p }), row("PAYMENT.CAPTURE.REFUNDED", {}, at, { paymentId: p, traceId: p, actor: "webhook" })];
    const two = [...refund("p1", "2026-10-24T10:00:00Z"), ...refund("p2", "2026-10-24T11:00:00Z")];
    expect(detectAnomalies(two, now)).toEqual([]);
    const three = [...two, ...refund("p3", "2026-10-24T12:00:00Z")];
    expect(detectAnomalies(three, now)).toMatchObject([{ signal: "refund", subject: "org", count: 3, traces: 3 }]);
  });

  it("ignores allowed proposals and other events", () => {
    const rows = [1, 2, 3].map((i) => row("agent.tool", { tool: "proposePurchase", outcome: "allow", memberId: "sam" }, `2026-10-24T0${i}:00:00Z`));
    expect(detectAnomalies(rows, now)).toEqual([]);
  });
});

describe("ES|QL", () => {
  it("is parameterised, not string-built", () => {
    expect(ANOMALY_ESQL).toContain("org_id == ?");
    expect(ANOMALY_ESQL).toContain("WHERE n >= ?");
  });

  it("parses columns and rows into anomalies", () => {
    const res = {
      columns: [{ name: "n" }, { name: "traces" }, { name: "latest" }, { name: "signal" }, { name: "subject" }, { name: "day" }],
      values: [[4, 2, "2026-10-24T11:00:00.000Z", "blocked", "sam", "2026-10-24T00:00:00.000Z"]],
    };
    expect(parseEsql(res)).toEqual([{ signal: "blocked", subject: "sam", day: "2026-10-24", count: 4, traces: 2, last: "2026-10-24T11:00:00.000Z" }]);
  });

  it("fails loudly on an unexpected answer, so the caller falls back", () => {
    expect(() => parseEsql({ columns: [{ name: "x" }], values: [] })).toThrow(/missing columns/);
  });
});
