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
    await apply(event);
  } catch (e) {
    // Stored already; log and still 200 so a bug here does not cause retry storms.
    console.error("Webhook handling failed", event.event_type, e);
  }
  return NextResponse.json({ ok: true });
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
