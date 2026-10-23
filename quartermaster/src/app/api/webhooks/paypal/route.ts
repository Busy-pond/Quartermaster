/**
 * PayPal webhook receiver.
 * 1. Verify the signature with PayPal.  2. Store the event id (idempotency).
 * 3. Update the payment it refers to.   Always answer 200 once stored, so PayPal stops retrying.
 */
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { PaymentStatus } from "@/lib/db/schema";
import { verifyWebhookSignature } from "@/lib/paypal/client";
import { audit } from "@/lib/purchases";
import { applyPayoutStatus, getReimbursement, syncPayout } from "@/lib/reimbursements/service";
import { creditSale, setSubscriptionStatus, syncInvoice } from "@/lib/funding/service";
import { saleCredit } from "@/lib/funding/events";

export const dynamic = "force-dynamic";

interface PayPalEvent {
  id: string;
  event_type: string;
  summary?: string;
  resource: {
    id?: string;
    custom_id?: string;
    status?: string;
    supplementary_data?: { related_ids?: { order_id?: string } };
    links?: { href: string; rel: string }[];
    purchase_units?: { custom_id?: string }[];
  };
}

export async function POST(req: Request) {
  const raw = await req.text();

  let verified = false;
  try {
    verified = await verifyWebhookSignature(req.headers, raw);
  } catch (e) {
    console.error("Webhook verification error", e);
  }
  if (!verified) return NextResponse.json({ error: "invalid signature" }, { status: 400 });

  const event = JSON.parse(raw) as PayPalEvent;
  const inserted = await db()
    .insert(schema.webhookEvents)
    .values({ id: event.id, type: event.event_type, payload: event })
    .onConflictDoNothing()
    .returning({ id: schema.webhookEvents.id });
  if (inserted.length === 0) return NextResponse.json({ ok: true, duplicate: true });

  try {
    if (event.event_type.startsWith("PAYMENT.PAYOUTS")) await applyPayout(event);
    else if (await applyMoneyIn(event)) {
      // handled: dues or a sponsor invoice
    } else await apply(event);
  } catch (e) {
    // Stored already; log and still 200 so a bug here does not cause retry storms.
    console.error("Webhook handling failed", event.event_type, e);
  }
  return NextResponse.json({ ok: true });
}

/**
 * Money in (Day 13). Dues: PAYMENT.SALE.COMPLETED carries the subscription id as billing_agreement_id;
 * BILLING.SUBSCRIPTION.* change its status. Invoices: INVOICING.INVOICE.* make us read the invoice
 * back from PayPal (the event body is not trusted for the amount). Returns false for other events.
 */
async function applyMoneyIn(event: PayPalEvent): Promise<boolean> {
  const t = event.event_type;
  const res = event.resource as Record<string, unknown> & { id?: string; status?: string; invoice?: { id?: string } };
  if (t === "PAYMENT.SALE.COMPLETED") {
    const c = saleCredit(res as Parameters<typeof saleCredit>[0]);
    if (c) await creditSale(c, "webhook");
    return true;
  }
  if (t.startsWith("BILLING.SUBSCRIPTION.")) {
    if (res.id) await setSubscriptionStatus(res.id, res.status ?? t.split(".").pop()!);
    return true;
  }
  if (t.startsWith("INVOICING.INVOICE.")) {
    const id = res.invoice?.id ?? res.id;
    if (id) await syncInvoice(id, "webhook");
    return true;
  }
  return false;
}

/**
 * Payouts (reimbursements). Item events carry the item status and our reimbursement id
 * as sender_item_id; batch events only say the batch finished, so we ask PayPal for the items.
 */
interface PayoutResource {
  payout_item_id?: string;
  payout_batch_id?: string;
  transaction_status?: string;
  payout_item?: { sender_item_id?: string };
  batch_header?: { payout_batch_id?: string; batch_status?: string };
}

async function applyPayout(event: PayPalEvent) {
  const res = event.resource as unknown as PayoutResource;
  const reimbursementId = res.payout_item?.sender_item_id;
  const batchId = res.payout_batch_id ?? res.batch_header?.payout_batch_id;
  const r =
    (reimbursementId && (await getReimbursement(reimbursementId))) ||
    (batchId && (await db().query.reimbursements.findFirst({ where: eq(schema.reimbursements.payoutBatchId, batchId) }))) ||
    undefined;
  if (!r) return;

  if (res.transaction_status) await applyPayoutStatus(r, { itemStatus: res.transaction_status, itemId: res.payout_item_id, source: "webhook" });
  else await syncPayout(r);

  await audit({
    orgId: r.orgId,
    traceId: r.traceId,
    paymentId: r.id,
    actor: "webhook",
    type: event.event_type,
    message: event.summary ?? event.event_type,
    payload: { eventId: event.id, batchId, itemId: res.payout_item_id, status: res.transaction_status ?? res.batch_header?.batch_status },
  });
}

async function findPayment(event: PayPalEvent) {
  const r = event.resource;
  const paymentId = r.custom_id ?? r.purchase_units?.[0]?.custom_id;
  if (paymentId) {
    const p = await db().query.payments.findFirst({ where: eq(schema.payments.id, paymentId) });
    if (p) return p;
  }
  const orderId = r.supplementary_data?.related_ids?.order_id;
  if (orderId) return db().query.payments.findFirst({ where: eq(schema.payments.paypalOrderId, orderId) });
  // Refunds link back to the capture they refund ("up")
  const captureId = r.links?.find((l) => l.rel === "up")?.href.split("/").pop();
  if (captureId) return db().query.payments.findFirst({ where: eq(schema.payments.paypalCaptureId, captureId) });
  return undefined;
}

async function apply(event: PayPalEvent) {
  const payment = await findPayment(event);
  if (!payment) return;

  const set = (status: PaymentStatus, extra: Partial<typeof schema.payments.$inferInsert> = {}) =>
    db().update(schema.payments).set({ status, updatedAt: new Date(), ...extra }).where(eq(schema.payments.id, payment.id));

  switch (event.event_type) {
    case "PAYMENT.CAPTURE.COMPLETED":
      if (payment.status !== "captured" && payment.status !== "refunded")
        await set("captured", { paypalCaptureId: event.resource.id ?? payment.paypalCaptureId, capturedAt: new Date() });
      break;
    case "PAYMENT.CAPTURE.DENIED":
    case "PAYMENT.CAPTURE.DECLINED":
      await set("failed");
      break;
    case "PAYMENT.CAPTURE.REFUNDED":
      await set("refunded");
      break;
    default:
      break;
  }

  await audit({
    orgId: payment.orgId,
    traceId: payment.traceId,
    paymentId: payment.id,
    actor: "webhook",
    type: event.event_type,
    message: event.summary ?? event.event_type,
    payload: { eventId: event.id, resourceId: event.resource.id, status: event.resource.status },
  });
}
