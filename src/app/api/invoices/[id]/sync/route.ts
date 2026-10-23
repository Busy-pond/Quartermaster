import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { handle } from "@/lib/http";
import { requireMember } from "@/lib/session";
import { syncInvoice } from "@/lib/funding/service";

/** "Check payment": asks PayPal for the invoice status, so a paid invoice is credited even without the webhook. */
export const POST = handle(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const me = await requireMember();
  const { id } = await ctx.params;
  const row = await db().query.invoices.findFirst({ where: eq(schema.invoices.id, id) });
  if (!row || row.orgId !== me.orgId || !row.paypalInvoiceId) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const updated = await syncInvoice(row.paypalInvoiceId, "system");
  return NextResponse.json({ status: updated?.status ?? row.status });
});
