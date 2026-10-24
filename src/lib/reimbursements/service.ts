/**
 * Snap-to-reimburse: photo -> Gemini reads it -> duplicate + receipt checks ->
 * mandate engine -> treasurer approves -> PayPal Payout -> confirmed paid.
 *
 * Every reimbursement needs the treasurer (policy 5.2), so the best outcome at
 * submit time is "needs_approval". A failed check or a mandate denial rejects it
 * straight away. The mandate is re-checked right before the payout is sent.
 */
import { createHash } from "node:crypto";
import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { ReimbursementStatus } from "@/lib/db/schema";
import { evaluate, type Decision } from "@/lib/mandates/engine";
import { audit, engineMandate, getMandate, loadLedger } from "@/lib/purchases";
import { assertApprover } from "@/lib/auth/roles";
import { createPayout, getPayout } from "@/lib/paypal/client";
import { money } from "@/lib/format";
import { extractReceipt } from "./extract";
import { DUPLICATE_WARN, duplicateScore, receiptChecks, toProposal, type ExtractedReceipt } from "./receipt";
import { fingerprintOf, indexReimbursement, search } from "@/lib/integrations/search";
import { semanticDuplicate } from "@/lib/search/text";

type ReimbursementRow = typeof schema.reimbursements.$inferSelect;
type MemberRow = typeof schema.members.$inferSelect;

export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

export function parseDataUrl(dataUrl: string): { bytes: Buffer; mediaType: string } {
  const m = dataUrl.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!m) throw new Error("The photo must be a JPEG, PNG or WebP image");
  const bytes = Buffer.from(m[2], "base64");
  if (bytes.length > MAX_IMAGE_BYTES) throw new Error("The photo is too large (over 4 MB). Try again; the page shrinks photos before sending.");
  if (bytes.length < 1000) throw new Error("The photo looks empty");
  return { bytes, mediaType: m[1] };
}

export const payeeFor = (member: Pick<MemberRow, "paypalEmail">) => member.paypalEmail?.trim() || process.env.SANDBOX_VOLUNTEER_EMAIL?.trim() || null;
export interface ManualEntry {
  merchant: string;
  date: string | null;
  totalCents: number;
  category: string;
}

export async function submitReimbursement(args: { member: MemberRow; mandateId: string; imageDataUrl: string; note?: string | null; manual?: ManualEntry | null }) {
  const { member } = args;
  const mandate = await getMandate(args.mandateId);
  if (!mandate || mandate.orgId !== member.orgId) throw new Error("Pick one of your team's spending mandates");
  const { bytes, mediaType } = parseDataUrl(args.imageDataUrl);
  const imageHash = createHash("sha256").update(bytes).digest("hex");
  const now = new Date();

  // 1. Read the receipt (or take what the volunteer typed if the model couldn't)
  const receipt: ExtractedReceipt = args.manual
    ? {
        isReceipt: true,
        merchant: args.manual.merchant.trim().slice(0, 120),
        merchantDomain: null,
        date: args.manual.date,
        currency: mandate.currency,
        items: [],
        taxCents: null,
        totalCents: args.manual.totalCents,
        confidence: "medium",
        notes: null,
        source: "manual",
      }
    : await extractReceipt({ image: bytes, mediaType, categories: mandate.categories, today: now.toISOString().slice(0, 10) });
  const fallbackCategory = args.manual?.category ?? mandate.categories[0] ?? "supplies";

  // 2. Duplicates: compare with every earlier receipt in the org that wasn't rejected
  const prior = await db()
    .select({
      id: schema.reimbursements.id,
      imageHash: schema.reimbursements.imageHash,
      merchant: schema.reimbursements.merchant,
      receiptDate: schema.reimbursements.receiptDate,
      totalCents: schema.reimbursements.totalCents,
    })
    .from(schema.reimbursements)
    .where(and(eq(schema.reimbursements.orgId, member.orgId), ne(schema.reimbursements.status, "rejected")));
  let dup = duplicateScore({ imageHash, merchant: receipt.merchant, date: receipt.date, totalCents: receipt.totalCents }, prior);
  const proposal = toProposal(receipt, fallbackCategory);

  // ...and by meaning (pgvector), which catches a re-photographed receipt read slightly differently. It only warns.
  const fingerprint = fingerprintOf({ merchant: receipt.merchant, receiptDate: receipt.date, totalCents: receipt.totalCents, lines: proposal.lines });
  if (dup.score < DUPLICATE_WARN) {
    const near = (await search().similarReceipts(member.orgId, fingerprint))[0];
    if (near && semanticDuplicate(near.similarity, receipt.totalCents, near.totalCents))
      dup = {
        score: DUPLICATE_WARN,
        matchId: near.id,
        reason: `Looks like the receipt from ${near.merchant ?? "the same store"}${near.receiptDate ? ` on ${near.receiptDate}` : ""} (${money(near.totalCents ?? 0, receipt.currency)}) already submitted; similarity ${near.similarity.toFixed(2)}`,
      };
  }

  // 3. Receipt checks and the mandate engine
  const payee = payeeFor(member);
  const checks = receiptChecks(receipt, dup, { now, hasPayee: !!payee });
  const decision = evaluate(await engineMandate(mandate), proposal, await loadLedger(mandate.id, now), now);
  const failed = checks.find((c) => c.state === "fail");
  const status: ReimbursementStatus = failed || decision.outcome === "deny" ? "rejected" : "needs_approval";
  const rejectedReason = failed ? `${failed.id}: ${failed.message ?? failed.label}` : decision.outcome === "deny" ? `${decision.clause}: ${decision.message}` : null;

  const [row] = await db()
    .insert(schema.reimbursements)
    .values({
      orgId: member.orgId,
      memberId: member.id,
      mandateId: mandate.id,
      receiptImage: args.imageDataUrl,
      imageHash,
      extracted: receipt,
      merchant: receipt.merchant,
      receiptDate: receipt.date,
      vendor: proposal.vendor,
      lines: proposal.lines,
      totalCents: receipt.totalCents,
      currency: receipt.currency,
      note: args.note?.trim().slice(0, 500) || null,
      duplicateScore: dup.score,
      duplicateOf: dup.matchId,
      checks,
      decision,
      status,
      rejectedReason,
      payeeEmail: payee,
    })
    .returning();
  await indexReimbursement(row); // for later duplicate and history searches; never fails the submission

  const base = { orgId: row.orgId, traceId: row.traceId, paymentId: row.id };
  await audit({ ...base, actor: "human", type: "reimbursement.submitted", message: `${member.name} submitted a receipt photo` });
  await audit({
    ...base,
    actor: "agent",
    type: "receipt.read",
    message:
      receipt.source === "manual"
        ? `Details typed in by hand: ${receipt.merchant}, ${money(receipt.totalCents, receipt.currency)}`
        : `Gemini read ${receipt.merchant || "an unknown merchant"}${receipt.date ? `, ${receipt.date}` : ""}, ${money(receipt.totalCents, receipt.currency)} (${receipt.confidence} confidence)`,
    payload: receipt,
  });
  await audit({
    ...base,
    actor: "system",
    type: "reimbursement.decided",
    message: rejectedReason ? `Rejected: ${rejectedReason}` : `Checks done; mandate engine: ${decision.outcome} (${decision.clause}). Waiting for the treasurer.`,
    payload: { decision, checks },
  });
  return row;
}

export async function getReimbursement(id: string) {
  return db().query.reimbursements.findFirst({ where: eq(schema.reimbursements.id, id) });
}

async function recheck(r: ReimbursementRow): Promise<Decision> {
  const m = r.mandateId ? await getMandate(r.mandateId) : undefined;
  if (!m) throw new Error("This reimbursement has no mandate");
  const now = new Date();
  return evaluate(
    await engineMandate(m),
    { vendor: r.vendor ?? "unknown-merchant", currency: r.currency ?? m.currency, totalCents: r.totalCents ?? 0, lines: r.lines ?? [] },
    await loadLedger(m.id, now, undefined, r.id),
    now,
  );
}

async function requireApprover(r: ReimbursementRow, approver: MemberRow) {
  assertApprover(r.mandateId ? await getMandate(r.mandateId) : undefined, approver);
}

/** Treasurer approves: re-check the mandate, then send the PayPal Payout. Safe against double clicks. */
export async function approveReimbursement(id: string, approver: MemberRow) {
  const r = await getReimbursement(id);
  if (!r) throw new Error("Reimbursement not found");
  await requireApprover(r, approver);
  if (r.status === "approved" || r.status === "paid") return r;
  if (r.status !== "needs_approval" && r.status !== "failed") throw new Error(`This reimbursement is ${r.status}`);

  const member = await db().query.members.findFirst({ where: eq(schema.members.id, r.memberId) });
  const payee = (member && payeeFor(member)) || r.payeeEmail || null;
  if (!payee) throw new Error("No PayPal email for this volunteer. Add SANDBOX_VOLUNTEER_EMAIL (your US sandbox personal account) to .env.local and restart.");

  const decision = await recheck(r);
  const base = { orgId: r.orgId, traceId: r.traceId, paymentId: r.id };
  if (decision.outcome === "deny") {
    await db().update(schema.reimbursements).set({ status: "rejected", decision, rejectedReason: `${decision.clause}: ${decision.message}`, updatedAt: new Date() }).where(eq(schema.reimbursements.id, r.id));
    await audit({ ...base, actor: "system", type: "reimbursement.blocked", message: `Blocked at payout time: ${decision.clause} — ${decision.message}`, payload: decision });
    throw new Error(`Blocked by mandate ${decision.clause}: ${decision.message}`);
  }

  // Claim it first, so a second click can't send a second payout.
  const claimed = await db()
    .update(schema.reimbursements)
    .set({ status: "approved", decision, approvedBy: approver.id, approvedAt: new Date(), payeeEmail: payee, payoutStatus: "SENDING", updatedAt: new Date() })
    .where(and(eq(schema.reimbursements.id, r.id), inArray(schema.reimbursements.status, ["needs_approval", "failed"])))
    .returning();
  if (claimed.length === 0) return (await getReimbursement(id))!;
  await audit({ ...base, actor: "human", type: "reimbursement.approved", message: `${approver.name} approved ${money(r.totalCents ?? 0, r.currency ?? "USD")}` });

  // A retry after a failed payout needs a new batch id; PayPal rejects reused ones.
  const senderBatchId = r.status === "failed" ? `reimb-${r.id}-${Date.now()}` : `reimb-${r.id}`;
  try {
    const res = await createPayout({
      senderBatchId,
      receiverEmail: payee,
      amountCents: r.totalCents ?? 0,
      currency: r.currency ?? "USD",
      note: `Reimbursement for your receipt from ${r.merchant ?? "a purchase"}${r.receiptDate ? ` on ${r.receiptDate}` : ""}. Thanks for volunteering!`,
      itemId: r.id,
    });
    const [updated] = await db()
      .update(schema.reimbursements)
      .set({ payoutBatchId: res.batch_header.payout_batch_id, payoutStatus: res.batch_header.batch_status, updatedAt: new Date() })
      .where(eq(schema.reimbursements.id, r.id))
      .returning();
    await audit({ ...base, actor: "system", type: "payout.created", message: `PayPal payout ${res.batch_header.payout_batch_id} sent to ${payee} (${res.batch_header.batch_status})`, payload: res.batch_header });
    return updated;
  } catch (e) {
    await db().update(schema.reimbursements).set({ status: "failed", payoutStatus: "ERROR", updatedAt: new Date() }).where(eq(schema.reimbursements.id, r.id));
    await audit({ ...base, actor: "system", type: "payout.failed", message: `PayPal refused the payout: ${e instanceof Error ? e.message : String(e)}` });
    throw e;
  }
}

export async function rejectReimbursement(id: string, approver: MemberRow, reason: string) {
  const r = await getReimbursement(id);
  if (!r) throw new Error("Reimbursement not found");
  await requireApprover(r, approver);
  if (r.status !== "needs_approval" && r.status !== "failed") throw new Error(`This reimbursement is ${r.status}`);
  const why = reason.trim().slice(0, 300) || "Rejected by the treasurer";
  const [updated] = await db()
    .update(schema.reimbursements)
    .set({ status: "rejected", rejectedReason: why, approvedBy: approver.id, approvedAt: new Date(), updatedAt: new Date() })
    .where(eq(schema.reimbursements.id, r.id))
    .returning();
  await audit({ orgId: r.orgId, traceId: r.traceId, paymentId: r.id, actor: "human", type: "reimbursement.rejected", message: `${approver.name} rejected it: ${why}` });
  return updated;
}

const ITEM_FAILED = new Set(["FAILED", "RETURNED", "BLOCKED", "DENIED", "REFUNDED", "REVERSED", "CANCELED"]);

/**
 * Applies a payout item status (from polling or a webhook). Only moves forward from
 * "approved", so a duplicate or late event can't flip a finished reimbursement.
 */
export async function applyPayoutStatus(r: ReimbursementRow, s: { itemStatus: string; itemId?: string | null; source: "webhook" | "system" }) {
  const status = s.itemStatus.toUpperCase();
  const base = { orgId: r.orgId, traceId: r.traceId, paymentId: r.id };
  if (status === "SUCCESS" || status === "SUCCEEDED") {
    const done = await db()
      .update(schema.reimbursements)
      .set({ status: "paid", paidAt: new Date(), payoutStatus: "SUCCESS", payoutItemId: s.itemId ?? r.payoutItemId, updatedAt: new Date() })
      .where(and(eq(schema.reimbursements.id, r.id), eq(schema.reimbursements.status, "approved")))
      .returning();
    if (done[0]) {
      const secs = Math.round((done[0].paidAt!.getTime() - r.createdAt.getTime()) / 1000);
      await audit({ ...base, actor: s.source, type: "payout.succeeded", message: `PayPal confirmed the payout: ${money(r.totalCents ?? 0, r.currency ?? "USD")} paid, ${secs} s after the photo was submitted` });
    }
    return done[0] ?? r;
  }
  if (ITEM_FAILED.has(status)) {
    const done = await db()
      .update(schema.reimbursements)
      .set({ status: "failed", payoutStatus: status, payoutItemId: s.itemId ?? r.payoutItemId, updatedAt: new Date() })
      .where(and(eq(schema.reimbursements.id, r.id), eq(schema.reimbursements.status, "approved")))
      .returning();
    if (done[0]) await audit({ ...base, actor: s.source, type: "payout.failed", message: `PayPal reports the payout as ${status}` });
    return done[0] ?? r;
  }
  // PENDING, ONHOLD, UNCLAIMED...: still in flight
  if (status !== r.payoutStatus) {
    const [u] = await db().update(schema.reimbursements).set({ payoutStatus: status, payoutItemId: s.itemId ?? r.payoutItemId, updatedAt: new Date() }).where(eq(schema.reimbursements.id, r.id)).returning();
    if (status === "UNCLAIMED")
      await audit({ ...base, actor: s.source, type: "payout.unclaimed", message: "PayPal has the money but the receiving email has no PayPal account yet (UNCLAIMED)" });
    return u;
  }
  return r;
}

/** Asks PayPal how the payout is doing. Used by the page while it waits, so it works without a webhook too. */
export async function syncPayout(r: ReimbursementRow) {
  if (r.status !== "approved" || !r.payoutBatchId) return r;
  const batch = await getPayout(r.payoutBatchId);
  const item = batch.items?.find((i) => i.payout_item?.sender_item_id === r.id) ?? batch.items?.[0];
  if (!item) return r;
  return applyPayoutStatus(r, { itemStatus: item.transaction_status, itemId: item.payout_item_id, source: "system" });
}

/** Lists for the treasurer's dashboard, without the (large) photos. */
export async function listReimbursements(orgId: string, limit = 25) {
  return db()
    .select({
      id: schema.reimbursements.id,
      memberId: schema.reimbursements.memberId,
      merchant: schema.reimbursements.merchant,
      receiptDate: schema.reimbursements.receiptDate,
      totalCents: schema.reimbursements.totalCents,
      currency: schema.reimbursements.currency,
      status: schema.reimbursements.status,
      rejectedReason: schema.reimbursements.rejectedReason,
      createdAt: schema.reimbursements.createdAt,
    })
    .from(schema.reimbursements)
    .where(eq(schema.reimbursements.orgId, orgId))
    .orderBy(desc(schema.reimbursements.createdAt))
    .limit(limit);
}
