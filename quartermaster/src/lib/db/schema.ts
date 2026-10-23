import { sql } from "drizzle-orm";
import { integer, jsonb, pgTable, real, text, timestamp, uniqueIndex, index, vector } from "drizzle-orm/pg-core";
import type { Decision, ProposalLine } from "@/lib/mandates/engine";
import type { ExtractedReceipt, ReceiptCheck } from "@/lib/reimbursements/receipt";
import type { OptionVerification } from "@/lib/verify/options";

/** Gemini embeddings are requested at this size (pgvector, Day 9). Changing it means re-indexing. */
export const EMBEDDING_DIMENSIONS = 768;

const id = () => text("id").primaryKey().$defaultFn(() => crypto.randomUUID());
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const orgs = pgTable("orgs", {
  id: id(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  createdAt: createdAt(),
});

export const members = pgTable("members", {
  id: id(),
  orgId: text("org_id").notNull().references(() => orgs.id),
  name: text("name").notNull(),
  email: text("email").notNull(),
  // Sandbox personal account email that receives reimbursements (Payouts)
  paypalEmail: text("paypal_email"),
  role: text("role", { enum: ["member", "treasurer"] }).notNull().default("member"),
  createdAt: createdAt(),
});

export const events = pgTable("events", {
  id: id(),
  orgId: text("org_id").notNull().references(() => orgs.id),
  name: text("name").notNull(),
  location: text("location"),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  createdAt: createdAt(),
});

/**
 * Vendors map a retailer domain (from Channel3) to the PayPal sandbox business
 * account that stands in for that retailer, so sandbox money has somewhere to go.
 */
export const vendors = pgTable(
  "vendors",
  {
    id: id(),
    orgId: text("org_id").notNull().references(() => orgs.id),
    domain: text("domain").notNull(),
    name: text("name").notNull(),
    payeeEmail: text("payee_email").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("vendors_org_domain").on(t.orgId, t.domain)],
);

export const mandates = pgTable("mandates", {
  id: id(),
  orgId: text("org_id").notNull().references(() => orgs.id),
  eventId: text("event_id").references(() => events.id),
  title: text("title").notNull(),
  status: text("status", { enum: ["draft", "active", "revoked"] }).notNull().default("draft"),
  currency: text("currency").notNull().default("USD"),
  capCents: integer("cap_cents").notNull(),
  perItemAutoLimitCents: integer("per_item_auto_limit_cents").notNull(),
  perOrderAutoLimitCents: integer("per_order_auto_limit_cents").notNull(),
  categories: text("categories").array().notNull(),
  vendorAllowlist: text("vendor_allowlist").array().notNull().default(sql`'{}'::text[]`),
  startsAt: timestamp("starts_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  approverIds: text("approver_ids").array().notNull(),
  signedBy: text("signed_by").references(() => members.id),
  signedAt: timestamp("signed_at", { withTimezone: true }),
  createdAt: createdAt(),
});

export const purchaseRequests = pgTable("purchase_requests", {
  id: id(),
  orgId: text("org_id").notNull().references(() => orgs.id),
  memberId: text("member_id").notNull().references(() => members.id),
  text: text("text").notNull(),
  traceId: text("trace_id").notNull().$defaultFn(() => crypto.randomUUID()),
  createdAt: createdAt(),
});

export const productOptions = pgTable(
  "product_options",
  {
    id: id(),
    requestId: text("request_id").notNull().references(() => purchaseRequests.id),
    source: text("source", { enum: ["channel3", "fixture"] }).notNull(),
    externalId: text("external_id").notNull(),
    title: text("title").notNull(),
    imageUrl: text("image_url"),
    url: text("url"),
    vendor: text("vendor").notNull(),
    priceCents: integer("price_cents").notNull(),
    currency: text("currency").notNull(),
    availability: text("availability"),
    createdAt: createdAt(),
  },
  (t) => [index("product_options_request").on(t.requestId)],
);

/** An option the agent compared, as snapshotted on the payment (with its KERNEL live check, if any). */
export interface ConsideredOption {
  title: string;
  vendor: string;
  priceCents: number;
  url?: string | null;
  verification?: OptionVerification | null;
}

export type PaymentStatus =
  | "denied"
  | "needs_approval"
  | "approved"
  | "captured"
  | "failed"
  | "refunded";

export const payments = pgTable(
  "payments",
  {
    id: id(),
    orgId: text("org_id").notNull().references(() => orgs.id),
    requestId: text("request_id").references(() => purchaseRequests.id),
    mandateId: text("mandate_id").notNull().references(() => mandates.id),
    vendor: text("vendor").notNull(),
    currency: text("currency").notNull(),
    totalCents: integer("total_cents").notNull(),
    lines: jsonb("lines").$type<ProposalLine[]>().notNull(),
    // Snapshot of the options the agent considered and why it picked this one
    optionsConsidered: jsonb("options_considered").$type<ConsideredOption[]>(),
    rationale: text("rationale"),
    decision: jsonb("decision").$type<Decision>().notNull(),
    status: text("status").$type<PaymentStatus>().notNull(),
    paypalOrderId: text("paypal_order_id"),
    paypalCaptureId: text("paypal_capture_id"),
    approvedBy: text("approved_by").references(() => members.id),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    capturedAt: timestamp("captured_at", { withTimezone: true }),
    traceId: text("trace_id").notNull(),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("payments_mandate").on(t.mandateId), index("payments_order").on(t.paypalOrderId)],
);

export type ReimbursementStatus = "submitted" | "needs_approval" | "approved" | "paid" | "rejected" | "failed";

/**
 * Snap-to-reimburse. Status: needs_approval (waiting for the treasurer) → approved
 * (payout sent, counts as committed) → paid (PayPal confirmed, counts as spent).
 * rejected = blocked by a check or the treasurer; failed = PayPal refused the payout.
 */
export const reimbursements = pgTable(
  "reimbursements",
  {
    id: id(),
    orgId: text("org_id").notNull().references(() => orgs.id),
    memberId: text("member_id").notNull().references(() => members.id),
    mandateId: text("mandate_id").references(() => mandates.id),
    // Compressed JPEG as a data URL (about 200–400 KB), so no file storage is needed
    receiptImage: text("receipt_image"),
    imageHash: text("image_hash"),
    extracted: jsonb("extracted").$type<ExtractedReceipt>(),
    merchant: text("merchant"),
    receiptDate: text("receipt_date"), // YYYY-MM-DD as printed
    vendor: text("vendor"),
    lines: jsonb("lines").$type<ProposalLine[]>(),
    totalCents: integer("total_cents"),
    currency: text("currency"),
    note: text("note"),
    duplicateScore: real("duplicate_score"),
    duplicateOf: text("duplicate_of"),
    checks: jsonb("checks").$type<ReceiptCheck[]>(),
    decision: jsonb("decision").$type<Decision>(),
    status: text("status").$type<ReimbursementStatus>().notNull().default("submitted"),
    rejectedReason: text("rejected_reason"),
    payeeEmail: text("payee_email"),
    payoutBatchId: text("payout_batch_id"),
    payoutItemId: text("payout_item_id"),
    payoutStatus: text("payout_status"),
    approvedBy: text("approved_by").references(() => members.id),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    traceId: text("trace_id").notNull().default(sql`gen_random_uuid()::text`),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("reimbursements_mandate").on(t.mandateId), index("reimbursements_batch").on(t.payoutBatchId), index("reimbursements_org_hash").on(t.orgId, t.imageHash)],
);

export const auditEvents = pgTable(
  "audit_events",
  {
    id: id(),
    orgId: text("org_id").notNull(),
    traceId: text("trace_id").notNull(),
    paymentId: text("payment_id"),
    actor: text("actor", { enum: ["agent", "human", "webhook", "system"] }).notNull(),
    type: text("type").notNull(),
    message: text("message").notNull(),
    payload: jsonb("payload"),
    createdAt: createdAt(),
  },
  (t) => [index("audit_trace").on(t.traceId), index("audit_payment").on(t.paymentId)],
);

/** Every PayPal webhook delivery we accepted — the primary key makes processing idempotent. */
export const webhookEvents = pgTable("webhook_events", {
  id: text("id").primaryKey(), // PayPal event id
  type: text("type").notNull(),
  payload: jsonb("payload").notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
});

/** The spending policy, one row per numbered clause, embedded for searchPolicy. Rebuilt by `npm run db:index`. */
export const policyChunks = pgTable(
  "policy_chunks",
  {
    id: id(),
    orgId: text("org_id").notNull().references(() => orgs.id),
    clause: text("clause").notNull(), // "3.3"
    section: text("section").notNull(),
    text: text("text").notNull(),
    embedding: vector("embedding", { dimensions: EMBEDDING_DIMENSIONS }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("policy_chunks_org_clause").on(t.orgId, t.clause), index("policy_chunks_embedding").using("hnsw", t.embedding.op("vector_cosine_ops"))],
);

/**
 * Embeddings of purchases (what was bought) and reimbursements (the receipt fingerprint),
 * kept apart from those tables so their everyday queries don't carry 768 floats per row.
 */
export const searchIndex = pgTable(
  "search_index",
  {
    id: id(),
    orgId: text("org_id").notNull().references(() => orgs.id),
    kind: text("kind", { enum: ["purchase", "reimbursement"] }).notNull(),
    refId: text("ref_id").notNull(), // payments.id or reimbursements.id
    text: text("text").notNull(),
    embedding: vector("embedding", { dimensions: EMBEDDING_DIMENSIONS }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("search_index_kind_ref").on(t.kind, t.refId), index("search_index_org_kind").on(t.orgId, t.kind), index("search_index_embedding").using("hnsw", t.embedding.op("vector_cosine_ops"))],
);

/**
 * Money coming IN (Day 13): member dues and sponsor invoices. Each PayPal transaction
 * is credited exactly once (unique paypal_id), and crediting raises the budget's cap.
 */
export const funding = pgTable(
  "funding",
  {
    id: id(),
    orgId: text("org_id").notNull().references(() => orgs.id),
    mandateId: text("mandate_id").notNull().references(() => mandates.id),
    source: text("source", { enum: ["dues", "invoice"] }).notNull(),
    paypalId: text("paypal_id").notNull(), // sale id (dues) or invoice id (sponsor)
    reference: text("reference"), // subscription id or our invoice row id
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").notNull(),
    note: text("note"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("funding_paypal_id").on(t.paypalId), index("funding_mandate").on(t.mandateId)],
);

/** Member dues subscriptions (PayPal Subscriptions). The id is PayPal's subscription id. */
export const subscriptions = pgTable("subscriptions", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull().references(() => orgs.id),
  memberId: text("member_id").notNull().references(() => members.id),
  planId: text("plan_id").notNull(),
  status: text("status").notNull(),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Sponsor invoices (PayPal Invoicing). The agent drafts; only the treasurer sends. */
export const invoices = pgTable(
  "invoices",
  {
    id: id(),
    orgId: text("org_id").notNull().references(() => orgs.id),
    mandateId: text("mandate_id").notNull().references(() => mandates.id),
    paypalInvoiceId: text("paypal_invoice_id"),
    sponsorEmail: text("sponsor_email").notNull(),
    sponsorName: text("sponsor_name"),
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").notNull(),
    note: text("note").notNull(),
    status: text("status").notNull(), // DRAFT, SENT, PAID, CANCELLED (PayPal's words)
    recipientUrl: text("recipient_url"),
    createdBy: text("created_by").notNull(), // member id who asked the agent
    sentBy: text("sent_by"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    traceId: text("trace_id").notNull(),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("invoices_paypal_id").on(t.paypalInvoiceId)],
);

/** Small key-value cache for third-party responses (Channel3, later KERNEL). */
export const apiCache = pgTable("api_cache", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  createdAt: createdAt(),
});
