import { describe, expect, it } from "vitest";
import { SPENDING_POLICY } from "@/lib/policy";
import { chunkPolicy, keywordScore, ledgerText, policyChunkText, receiptFingerprint, semanticDuplicate } from "./text";

describe("chunkPolicy", () => {
  const chunks = chunkPolicy(SPENDING_POLICY);

  it("makes one chunk per numbered clause", () => {
    expect(chunks.map((c) => c.clause)).toEqual(["1.1", "1.2", "2.1", "2.2", "2.3", "3.1", "3.2", "3.3", "4.1", "4.2", "5.1", "5.2", "5.3"]);
  });

  it("keeps the section heading and the clause text", () => {
    const c33 = chunks.find((c) => c.clause === "3.3")!;
    expect(c33.section).toBe("Quotes and approval");
    expect(c33.text).toMatch(/at least two vendors/);
    expect(policyChunkText(c33)).toBe(`Policy 3.3 (Quotes and approval): ${c33.text}`);
  });

  it("joins wrapped lines into the clause above", () => {
    const c = chunkPolicy("1. Money\n1.1 First line\ncontinues here\n1.2 Second");
    expect(c).toEqual([
      { clause: "1.1", section: "Money", text: "First line continues here" },
      { clause: "1.2", section: "Money", text: "Second" },
    ]);
  });

  it("ignores the title line", () => {
    expect(chunkPolicy("# Title\n\n1. A\n1.1 x")).toEqual([{ clause: "1.1", section: "A", text: "x" }]);
  });
});

describe("keywordScore", () => {
  it("finds the quotes clause for a question about quotes", () => {
    const chunks = chunkPolicy(SPENDING_POLICY);
    const best = chunks.map((c) => ({ c, s: keywordScore("how many vendors do we compare for big orders?", policyChunkText(c)) })).sort((a, b) => b.s - a.s)[0];
    expect(best.c.clause).toBe("3.3");
  });
  it("is 0 for a query of only stop words", () => expect(keywordScore("do we need the", "anything")).toBe(0));
  it("stems plurals", () => expect(keywordScore("receipts", "a receipt")).toBe(1));
});

describe("ledgerText and receiptFingerprint", () => {
  it("leaves out the tax line", () => {
    expect(
      ledgerText({ kind: "reimbursement", vendor: "homedepot.com", merchant: "The Home Depot", lines: [{ description: "Gloves", category: "safety" }, { description: "Tax and fees", category: "safety" }] }),
    ).toBe("Reimbursed receipt from The Home Depot: Gloves (safety)");
  });
  it("names the vendor for purchases", () => {
    expect(ledgerText({ kind: "purchase", vendor: "uline.com", lines: [{ description: "Trash bags", category: "supplies" }] })).toBe("Purchase from uline.com: Trash bags (supplies)");
  });
  it("formats the receipt total in dollars", () => {
    expect(receiptFingerprint({ merchant: "Walmart", date: "2026-10-22", totalCents: 2781, items: ["Tape"] })).toBe("Receipt from Walmart on 2026-10-22, total 27.81: Tape");
  });
});

describe("semanticDuplicate", () => {
  it("warns on a near-identical fingerprint with the same total", () => expect(semanticDuplicate(0.95, 2781, 2781)).toBe(true));
  it("allows a small misread of the total (within 5%)", () => expect(semanticDuplicate(0.95, 2781, 2871)).toBe(true));
  it("ignores a similar trip to the same store with a different total", () => expect(semanticDuplicate(0.95, 2781, 4217)).toBe(false));
  it("ignores low similarity", () => expect(semanticDuplicate(0.8, 2781, 2781)).toBe(false));
  it("needs both totals", () => expect(semanticDuplicate(0.99, null, 2781)).toBe(false));
});
