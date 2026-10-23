/**
 * Money in, the pure part (Day 13): turns PayPal webhook resources and API
 * objects into credits. A credit is keyed by PayPal's own transaction id, so
 * the webhook and the polling fallback can both see it and it still counts once.
 */

export interface Credit {
  paypalId: string;
  amountCents: number;
  currency: string;
  reference: string | null; // subscription id, or PayPal invoice id
}

const cents = (v: string | number | undefined | null) => {
  const n = typeof v === "string" ? Number(v) : v;
  return n == null || !Number.isFinite(n) ? 0 : Math.round(n * 100);
};

/** PAYMENT.SALE.COMPLETED for a subscription payment. Null for anything that isn't a completed dues payment. */
export function saleCredit(resource: { id?: string; state?: string; billing_agreement_id?: string; amount?: { total?: string; currency?: string } } | null | undefined): Credit | null {
  if (!resource?.id || !resource.billing_agreement_id) return null;
  if (resource.state && resource.state.toLowerCase() !== "completed") return null;
  const amountCents = cents(resource.amount?.total);
  if (amountCents <= 0) return null;
  return { paypalId: resource.id, amountCents, currency: resource.amount?.currency ?? "USD", reference: resource.billing_agreement_id };
}

/** A subscription transaction from GET /v1/billing/subscriptions/{id}/transactions (the polling fallback). */
export function transactionCredit(subscriptionId: string, t: { id: string; status: string; amount_with_breakdown?: { gross_amount?: { value?: string; currency_code?: string } } }): Credit | null {
  if (t.status !== "COMPLETED") return null;
  const amountCents = cents(t.amount_with_breakdown?.gross_amount?.value);
  if (amountCents <= 0) return null;
  return { paypalId: t.id, amountCents, currency: t.amount_with_breakdown?.gross_amount?.currency_code ?? "USD", reference: subscriptionId };
}

type InvoiceLike = { id?: string; status?: string; amount?: { value?: string; currency_code?: string }; payments?: { paid_amount?: { value?: string; currency_code?: string } } };

/** INVOICING.INVOICE.PAID (the resource is the invoice, sometimes wrapped in { invoice }), or an invoice read back from the API. */
export function invoiceCredit(resource: (InvoiceLike & { invoice?: InvoiceLike }) | null | undefined): Credit | null {
  const inv = resource?.invoice ?? resource;
  if (!inv?.id || (inv.status !== "PAID" && inv.status !== "MARKED_AS_PAID")) return null;
  const paid = inv.payments?.paid_amount ?? inv.amount;
  const amountCents = cents(paid?.value);
  if (amountCents <= 0) return null;
  // One credit per invoice: the invoice id is the key (partial payments aren't used here).
  return { paypalId: `invoice:${inv.id}`, amountCents, currency: paid?.currency_code ?? "USD", reference: inv.id };
}

/** Effective budget after credits: the cap the treasurer signed plus money that came in for it. */
export const capWithFunding = (signedCapCents: number, credits: { amountCents: number }[]) => signedCapCents + credits.reduce((s, c) => s + c.amountCents, 0);
