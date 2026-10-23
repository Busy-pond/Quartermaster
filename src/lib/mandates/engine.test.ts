import { describe, expect, it } from "vitest";
import { evaluate, type Ledger, type Mandate, type Proposal } from "./engine";

const NOW = new Date("2026-11-20T10:00:00Z");

const mandate = (o: Partial<Mandate> = {}): Mandate => ({
  id: "m_cleanup",
  status: "active",
  currency: "USD",
  capCents: 60_000, // $600
  perItemAutoLimitCents: 15_000, // $150
  perOrderAutoLimitCents: 25_000, // $250
  categories: ["supplies", "safety"],
  vendorAllowlist: [],
  startsAt: "2026-11-01T00:00:00Z",
  expiresAt: "2026-12-10T00:00:00Z",
  approverIds: ["u_treasurer"],
  ...o,
});

const proposal = (o: Partial<Proposal> = {}): Proposal => ({
  vendor: "acme-supplies.com",
  currency: "USD",
  totalCents: 10_000,
  lines: [{ description: "Water bottles", category: "supplies", unitPriceCents: 500, quantity: 20 }],
  ...o,
});

const ledger = (o: Partial<Ledger> = {}): Ledger => ({ spentCents: 0, committedCents: 0, recent: [], ...o });

describe("allow", () => {
  it("allows a small in-policy purchase", () => {
    const d = evaluate(mandate(), proposal(), ledger(), NOW);
    expect(d.outcome).toBe("allow");
    expect(d.clause).toBe("OK");
    expect(d.reasons).toEqual([]);
    expect(d.remainingAfterCents).toBe(50_000);
  });

  it("allows a purchase that lands exactly on the cap", () => {
    const d = evaluate(
      mandate(),
      proposal({ totalCents: 20_000, lines: [{ description: "Gloves", category: "safety", unitPriceCents: 1_000, quantity: 20 }] }),
      ledger({ spentCents: 40_000 }),
      NOW,
    );
    expect(d.outcome).toBe("allow");
    expect(d.remainingAfterCents).toBe(0);
  });

  it("matches categories and vendors case-insensitively", () => {
    const d = evaluate(
      mandate({ vendorAllowlist: ["ACME-Supplies.com"] }),
      proposal({ vendor: "acme-supplies.com ", lines: [{ description: "Bottles", category: "Supplies", unitPriceCents: 500, quantity: 20 }] }),
      ledger(),
      NOW,
    );
    expect(d.outcome).toBe("allow");
  });

  it("treats an empty vendor allowlist as any vendor", () => {
    expect(evaluate(mandate({ vendorAllowlist: [] }), proposal({ vendor: "anyshop.com" }), ledger(), NOW).outcome).toBe("allow");
  });

  it("allows an item priced exactly at the per-item limit", () => {
    const p = proposal({ totalCents: 15_000, lines: [{ description: "Table", category: "supplies", unitPriceCents: 15_000, quantity: 1 }] });
    expect(evaluate(mandate(), p, ledger(), NOW).outcome).toBe("allow");
  });

  it("ignores earlier purchases outside the 24h split window", () => {
    const d = evaluate(
      mandate(),
      proposal({ totalCents: 20_000, lines: [{ description: "Bags", category: "supplies", unitPriceCents: 1_000, quantity: 20 }] }),
      ledger({ recent: [{ vendor: "acme-supplies.com", category: "supplies", totalCents: 20_000, createdAt: "2026-11-19T09:59:00Z" }] }),
      NOW,
    );
    expect(d.outcome).toBe("allow");
  });
});

describe("needs approval", () => {
  it("asks when a unit price exceeds the per-item limit", () => {
    const p = proposal({ totalCents: 15_001, lines: [{ description: "Folding table", category: "supplies", unitPriceCents: 15_001, quantity: 1 }] });
    const d = evaluate(mandate(), p, ledger(), NOW);
    expect(d.outcome).toBe("needs_approval");
    expect(d.clause).toBe("M8");
  });

  it("asks when the order total exceeds the per-order limit", () => {
    const p = proposal({ totalCents: 30_000, lines: [{ description: "Bottles", category: "supplies", unitPriceCents: 1_500, quantity: 20 }] });
    const d = evaluate(mandate(), p, ledger(), NOW);
    expect(d.outcome).toBe("needs_approval");
    expect(d.clause).toBe("M9");
  });

  it("catches a large order split into small ones at the same vendor", () => {
    const d = evaluate(
      mandate(),
      proposal({ totalCents: 20_000, lines: [{ description: "Bottles", category: "supplies", unitPriceCents: 1_000, quantity: 20 }] }),
      ledger({ recent: [{ vendor: "acme-supplies.com", category: "supplies", totalCents: 20_000, createdAt: "2026-11-20T08:00:00Z" }] }),
      NOW,
    );
    expect(d.outcome).toBe("needs_approval");
    expect(d.clause).toBe("M10");
  });

  it("does not flag splits across different vendors", () => {
    const d = evaluate(
      mandate(),
      proposal({ totalCents: 20_000, lines: [{ description: "Bottles", category: "supplies", unitPriceCents: 1_000, quantity: 20 }] }),
      ledger({ recent: [{ vendor: "other-shop.com", category: "supplies", totalCents: 20_000, createdAt: "2026-11-20T08:00:00Z" }] }),
      NOW,
    );
    expect(d.outcome).toBe("allow");
  });

  it("reports every approval reason, not just the first", () => {
    const p = proposal({ totalCents: 40_000, lines: [{ description: "Tent", category: "supplies", unitPriceCents: 20_000, quantity: 2 }] });
    const d = evaluate(mandate(), p, ledger(), NOW);
    expect(d.outcome).toBe("needs_approval");
    expect(d.reasons.map((r) => r.clause)).toEqual(["M8", "M9"]);
  });
});

describe("deny", () => {
  it("denies when the cap would be exceeded", () => {
    const d = evaluate(mandate(), proposal(), ledger({ spentCents: 55_000 }), NOW);
    expect(d.outcome).toBe("deny");
    expect(d.clause).toBe("M7");
  });

  it("counts committed (approved, not yet captured) money against the cap", () => {
    const d = evaluate(mandate(), proposal(), ledger({ spentCents: 30_000, committedCents: 25_000 }), NOW);
    expect(d.outcome).toBe("deny");
    expect(d.clause).toBe("M7");
  });

  it("denies one cent over the cap", () => {
    const p = proposal({ totalCents: 20_001, lines: [{ description: "Gloves", category: "safety", unitPriceCents: 20_001, quantity: 1 }] });
    expect(evaluate(mandate(), p, ledger({ spentCents: 40_000 }), NOW).clause).toBe("M7");
  });

  it("denies after expiry, even by one second", () => {
    const d = evaluate(mandate({ expiresAt: "2026-11-20T09:59:59Z" }), proposal(), ledger(), NOW);
    expect(d.outcome).toBe("deny");
    expect(d.clause).toBe("M3");
  });

  it("denies at the exact expiry instant", () => {
    expect(evaluate(mandate({ expiresAt: NOW.toISOString() }), proposal(), ledger(), NOW).clause).toBe("M3");
  });

  it("denies before the mandate starts", () => {
    expect(evaluate(mandate({ startsAt: "2026-11-21T00:00:00Z" }), proposal(), ledger(), NOW).clause).toBe("M2");
  });

  it("denies a revoked mandate", () => {
    expect(evaluate(mandate({ status: "revoked" }), proposal(), ledger(), NOW).clause).toBe("M1");
  });

  it("denies a draft mandate", () => {
    expect(evaluate(mandate({ status: "draft" }), proposal(), ledger(), NOW).clause).toBe("M1");
  });

  it("denies a currency mismatch", () => {
    expect(evaluate(mandate(), proposal({ currency: "EUR" }), ledger(), NOW).clause).toBe("M4");
  });

  it("denies a disallowed category", () => {
    const p = proposal({ lines: [{ description: "Pizza", category: "food", unitPriceCents: 500, quantity: 20 }] });
    const d = evaluate(mandate(), p, ledger(), NOW);
    expect(d.outcome).toBe("deny");
    expect(d.clause).toBe("M5");
    expect(d.message).toContain("food");
  });

  it("denies a vendor that is not on the allowlist", () => {
    expect(evaluate(mandate({ vendorAllowlist: ["trusted.com"] }), proposal(), ledger(), NOW).clause).toBe("M6");
  });

  it("lets a deny win over an approval reason", () => {
    const p = proposal({ totalCents: 70_000, lines: [{ description: "Generator", category: "supplies", unitPriceCents: 70_000, quantity: 1 }] });
    const d = evaluate(mandate(), p, ledger(), NOW);
    expect(d.outcome).toBe("deny");
    expect(d.clause).toBe("M7");
    expect(d.reasons.some((r) => r.outcome === "needs_approval")).toBe(true);
  });
});

describe("malformed proposals (M0)", () => {
  const cases: [string, Partial<Proposal>][] = [
    ["total does not match the items", { totalCents: 9_999 }],
    ["no items", { lines: [], totalCents: 0 }],
    ["fractional quantity", { totalCents: 750, lines: [{ description: "x", category: "supplies", unitPriceCents: 500, quantity: 1.5 }] }],
    ["zero price", { totalCents: 0, lines: [{ description: "x", category: "supplies", unitPriceCents: 0, quantity: 1 }] }],
    ["negative price", { totalCents: -500, lines: [{ description: "x", category: "supplies", unitPriceCents: -500, quantity: 1 }] }],
    ["fractional cents", { totalCents: 10.5, lines: [{ description: "x", category: "supplies", unitPriceCents: 10.5, quantity: 1 }] }],
    ["empty vendor", { vendor: " " }],
    ["bad currency code", { currency: "usd" }],
    ["missing category", { lines: [{ description: "x", category: "", unitPriceCents: 500, quantity: 20 }] }],
  ];
  for (const [name, o] of cases) {
    it(`denies: ${name}`, () => {
      const d = evaluate(mandate(), proposal(o), ledger(), NOW);
      expect(d.outcome).toBe("deny");
      expect(d.clause).toBe("M0");
    });
  }

  it("denies a corrupt ledger", () => {
    expect(evaluate(mandate(), proposal(), ledger({ spentCents: -1 }), NOW).clause).toBe("M0");
  });
});

describe("determinism", () => {
  it("returns the same decision for the same input", () => {
    const a = evaluate(mandate(), proposal(), ledger(), NOW);
    const b = evaluate(mandate(), proposal(), ledger(), NOW);
    expect(a).toEqual(b);
  });
});
