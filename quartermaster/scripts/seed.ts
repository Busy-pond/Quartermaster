/**
 * Builds the demo org in one command:  npm run db:seed
 * Safe to re-run: it deletes the demo org's rows first.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { eq, inArray } from "drizzle-orm";
import { db, schema } from "../src/lib/db";
import { evaluate } from "../src/lib/mandates/engine";
import { backfillIndex, indexPolicy } from "../src/lib/integrations/search";

const SLUG = "riverside";
const dollars = (n: number) => Math.round(n * 100);

async function wipe() {
  const d = db();
  const org = await d.query.orgs.findFirst({ where: eq(schema.orgs.slug, SLUG) });
  if (!org) return;
  const reqs = await d.select({ id: schema.purchaseRequests.id }).from(schema.purchaseRequests).where(eq(schema.purchaseRequests.orgId, org.id));
  const reqIds = reqs.map((r) => r.id);
  await d.delete(schema.auditEvents).where(eq(schema.auditEvents.orgId, org.id));
  await d.delete(schema.searchIndex).where(eq(schema.searchIndex.orgId, org.id));
  await d.delete(schema.policyChunks).where(eq(schema.policyChunks.orgId, org.id));
  await d.delete(schema.payments).where(eq(schema.payments.orgId, org.id));
  if (reqIds.length) await d.delete(schema.productOptions).where(inArray(schema.productOptions.requestId, reqIds));
  await d.delete(schema.purchaseRequests).where(eq(schema.purchaseRequests.orgId, org.id));
  await d.delete(schema.reimbursements).where(eq(schema.reimbursements.orgId, org.id));
  await d.delete(schema.mandates).where(eq(schema.mandates.orgId, org.id));
  await d.delete(schema.vendors).where(eq(schema.vendors.orgId, org.id));
  await d.delete(schema.events).where(eq(schema.events.orgId, org.id));
  await d.delete(schema.members).where(eq(schema.members.orgId, org.id));
  await d.delete(schema.orgs).where(eq(schema.orgs.id, org.id));
}

async function main() {
  const payee = process.env.SANDBOX_PAYEE_EMAIL;
  const volunteerPaypal = process.env.SANDBOX_VOLUNTEER_EMAIL ?? null;
  if (!payee) console.warn("! SANDBOX_PAYEE_EMAIL not set — orders will go to your app's own sandbox business account.");

  await wipe();
  const d = db();

  const [org] = await d.insert(schema.orgs).values({ name: "Riverside Cleanup Crew", slug: SLUG }).returning();

  const [treasurer, ...volunteers] = await d
    .insert(schema.members)
    .values([
      { orgId: org.id, name: "Priya Nair", email: "priya@riverside.example", role: "treasurer" },
      { orgId: org.id, name: "Arjun Mehta", email: "arjun@riverside.example", paypalEmail: volunteerPaypal },
      { orgId: org.id, name: "Sofia Alvarez", email: "sofia@riverside.example", paypalEmail: volunteerPaypal },
      { orgId: org.id, name: "Tom Becker", email: "tom@riverside.example", paypalEmail: volunteerPaypal },
      { orgId: org.id, name: "Mei Lin", email: "mei@riverside.example", paypalEmail: volunteerPaypal },
      { orgId: org.id, name: "Kwame Asante", email: "kwame@riverside.example", paypalEmail: volunteerPaypal },
    ])
    .returning();

  const [beach, food] = await d
    .insert(schema.events)
    .values([
      { orgId: org.id, name: "Beach Cleanup Drive", location: "Marina Beach, north end", startsAt: new Date("2026-12-12T07:00:00+05:30") },
      { orgId: org.id, name: "Winter Food Drive", location: "Community hall", startsAt: new Date("2026-12-20T10:00:00+05:30") },
    ])
    .returning();

  // Retailer domains we expect from Channel3 for the demo queries, all routed to the sandbox stand-in.
  const vendorDomains = [
    ["amazon.com", "Amazon"],
    ["walmart.com", "Walmart"],
    ["target.com", "Target"],
    ["homedepot.com", "The Home Depot"],
    ["uline.com", "Uline"],
    ["acme-supplies.com", "Acme Supplies"],
  ];
  if (payee)
    await d.insert(schema.vendors).values(vendorDomains.map(([domain, name]) => ({ orgId: org.id, domain, name, payeeEmail: payee })));

  const [beachMandate, foodMandate] = await d
    .insert(schema.mandates)
    .values([
      {
        orgId: org.id,
        eventId: beach.id,
        title: "Beach Cleanup Drive — supplies & safety",
        status: "active",
        currency: "USD",
        capCents: dollars(600),
        perItemAutoLimitCents: dollars(150),
        perOrderAutoLimitCents: dollars(250),
        categories: ["supplies", "safety"],
        vendorAllowlist: [],
        startsAt: new Date("2026-10-01T00:00:00Z"),
        expiresAt: new Date("2026-12-10T00:00:00+05:30"),
        approverIds: [treasurer.id],
        signedBy: treasurer.id,
        signedAt: new Date(),
      },
      {
        orgId: org.id,
        eventId: food.id,
        title: "Winter Food Drive — food & printing",
        status: "active",
        currency: "USD",
        capCents: dollars(400),
        perItemAutoLimitCents: dollars(100),
        perOrderAutoLimitCents: dollars(200),
        categories: ["food", "printing", "supplies"],
        vendorAllowlist: [],
        startsAt: new Date("2026-10-01T00:00:00Z"),
        expiresAt: new Date("2026-12-18T00:00:00+05:30"),
        approverIds: [treasurer.id],
        signedBy: treasurer.id,
        signedAt: new Date(),
      },
    ])
    .returning();

  // A little history so budgets and the dashboard are not empty.
  const history = [
    { m: beachMandate, vendor: "uline.com", desc: "Heavy-duty trash bags (100)", cat: "supplies", price: 38.5, qty: 2, by: volunteers[0], daysAgo: 12 },
    { m: beachMandate, vendor: "homedepot.com", desc: "Work gloves", cat: "safety", price: 4.25, qty: 20, by: volunteers[1], daysAgo: 9 },
    { m: foodMandate, vendor: "walmart.com", desc: "Collection crates", cat: "supplies", price: 12, qty: 6, by: volunteers[2], daysAgo: 6 },
    { m: foodMandate, vendor: "target.com", desc: "Flyer printing", cat: "printing", price: 0.35, qty: 200, by: volunteers[3], daysAgo: 3 },
  ];
  for (const h of history) {
    const totalCents = dollars(h.price) * h.qty;
    const lines = [{ description: h.desc, category: h.cat, unitPriceCents: dollars(h.price), quantity: h.qty }];
    const at = new Date(Date.now() - h.daysAgo * 86_400_000);
    const [req] = await d.insert(schema.purchaseRequests).values({ orgId: org.id, memberId: h.by.id, text: `Seeded: ${h.desc}`, createdAt: at }).returning();
    const decision = evaluate(
      { ...h.m, startsAt: h.m.startsAt?.toISOString() ?? null, expiresAt: h.m.expiresAt.toISOString() },
      { vendor: h.vendor, currency: "USD", totalCents, lines },
      { spentCents: 0, committedCents: 0, recent: [] },
      at,
    );
    await d.insert(schema.payments).values({
      orgId: org.id,
      requestId: req.id,
      mandateId: h.m.id,
      vendor: h.vendor,
      currency: "USD",
      totalCents,
      lines,
      rationale: "Seeded history",
      decision,
      status: "captured",
      traceId: req.traceId,
      approvedBy: treasurer.id,
      approvedAt: at,
      capturedAt: at,
      createdAt: at,
    });
  }

  const policy = await indexPolicy(org.id);
  const indexed = await backfillIndex(org.id);

  console.log(`✓ Seeded "${org.name}": ${volunteers.length + 1} members, 2 events, 2 mandates, ${history.length} past purchases`);
  console.log(`✓ Search index: ${policy.chunks} policy clauses (${policy.embedded} embedded), ${indexed} purchases embedded`);
  console.log(`  Treasurer: ${treasurer.name}   Volunteer: ${volunteers[0].name}`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
