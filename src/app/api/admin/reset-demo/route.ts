import { NextResponse } from "next/server";
import { checkAdminSecret } from "@/lib/admin/guard";
import { seedDemo } from "@/lib/demo/seed";
import { setupDues } from "@/lib/funding/service";
import { friendlyDbError } from "@/lib/http";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Resets the hosted demo before a recording (Day 20): the same seed as `npm run db:seed`,
 * then the dues setup (`npm run setup:dues`, PayPal sandbox). Needs
 * `Authorization: Bearer <APP_SECRET>`; refused when APP_SECRET is unset.
 */
export async function POST(req: Request) {
  const auth = checkAdminSecret(req.headers.get("authorization"), process.env.APP_SECRET);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let seeded: Awaited<ReturnType<typeof seedDemo>>;
  try {
    seeded = await seedDemo();
  } catch (e) {
    console.error("reset-demo: seed failed", e);
    return NextResponse.json({ error: friendlyDbError(e) }, { status: 503 });
  }
  // The seed is done either way; a PayPal hiccup on the dues plan is reported, not rolled back.
  const dues = await setupDues(seeded.orgId).then(
    (plan) => ({ ok: true as const, planId: plan.planId, amountCents: plan.amountCents }),
    (e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) }),
  );
  return NextResponse.json({ ok: dues.ok, seeded, dues }, { status: dues.ok ? 200 : 207 });
}
