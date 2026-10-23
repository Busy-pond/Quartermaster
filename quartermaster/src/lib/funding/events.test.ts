import { describe, expect, it } from "vitest";
import { capWithFunding, invoiceCredit, saleCredit, transactionCredit } from "./events";
import { envelopes, type LedgerRow } from "@/lib/dashboard/aggregate";

describe("saleCredit (PAYMENT.SALE.COMPLETED)", () => {
  const sale = { id: "8PA12345", state: "completed", billing_agreement_id: "I-ABC123", amount: { total: "10.00", currency: "USD" } };
  it("credits a completed dues payment by its sale id", () => {
    expect(saleCredit(sale)).toEqual({ paypalId: "8PA12345", amountCents: 1000, currency: "USD", reference: "I-ABC123" });
  });
  it("ignores sales that aren't subscription payments", () => expect(saleCredit({ ...sale, billing_agreement_id: undefined })).toBeNull());
  it("ignores pending or zero sales", () => {
    expect(saleCredit({ ...sale, state: "pending" })).toBeNull();
    expect(saleCredit({ ...sale, amount: { total: "0.00" } })).toBeNull();
    expect(saleCredit(null)).toBeNull();
  });
});

describe("transactionCredit (polling fallback)", () => {
  it("uses the same id as the webhook, so a payment can't count twice", () => {
    const fromPoll = transactionCredit("I-ABC123", { id: "8PA12345", status: "COMPLETED", amount_with_breakdown: { gross_amount: { value: "10.00", currency_code: "USD" } } });
    const fromHook = saleCredit({ id: "8PA12345", state: "completed", billing_agreement_id: "I-ABC123", amount: { total: "10.00", currency: "USD" } });
    expect(fromPoll?.paypalId).toBe(fromHook?.paypalId);
  });
  it("skips refunded or pending transactions", () => {
    expect(transactionCredit("I-1", { id: "x", status: "REFUNDED", amount_with_breakdown: { gross_amount: { value: "10.00" } } })).toBeNull();
  });
});

describe("invoiceCredit (INVOICING.INVOICE.PAID)", () => {
  const inv = { id: "INV2-AAAA-BBBB", status: "PAID", amount: { value: "250.00", currency_code: "USD" }, payments: { paid_amount: { value: "250.00", currency_code: "USD" } } };
  it("credits a paid invoice once, keyed by the invoice", () => {
    expect(invoiceCredit(inv)).toEqual({ paypalId: "invoice:INV2-AAAA-BBBB", amountCents: 25000, currency: "USD", reference: "INV2-AAAA-BBBB" });
  });
  it("accepts the wrapped webhook shape", () => expect(invoiceCredit({ invoice: inv })?.amountCents).toBe(25000));
  it("ignores unpaid invoices", () => {
    expect(invoiceCredit({ ...inv, status: "SENT" })).toBeNull();
    expect(invoiceCredit({ ...inv, status: "DRAFT" })).toBeNull();
  });
  it("counts MARKED_AS_PAID too", () => expect(invoiceCredit({ ...inv, status: "MARKED_AS_PAID" })?.amountCents).toBe(25000));
});

describe("ledger maths with money in and refunds", () => {
  const ops = { id: "ops", title: "Operations", event: null };
  const rows: LedgerRow[] = [
    { kind: "purchase", mandateId: "ops", status: "captured", totalCents: 6000, lines: [], createdAt: new Date() },
    { kind: "purchase", mandateId: "ops", status: "refunded", totalCents: 4000, lines: [], createdAt: new Date() },
  ];
  it("dues and sponsorships raise the cap; a refund gives the money back", () => {
    const cap = capWithFunding(10000, [{ amountCents: 1000 }, { amountCents: 25000 }]);
    expect(cap).toBe(36000);
    const [e] = envelopes([{ ...ops, capCents: cap }], rows);
    expect(e.spentCents).toBe(6000); // the refunded $40 isn't spent
    expect(e.remainingCents).toBe(30000);
  });
});
