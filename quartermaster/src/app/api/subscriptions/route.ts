import { NextResponse } from "next/server";
import { z } from "zod";
import { handle } from "@/lib/http";
import { requireMember } from "@/lib/session";
import { recordSubscription } from "@/lib/funding/service";

const Body = z.object({ subscriptionId: z.string().regex(/^I-[A-Z0-9]+$/, "Not a PayPal subscription id") });

/** Called by /join after the member approves in PayPal. The server checks the subscription with PayPal itself. */
export const POST = handle(async (req: Request) => {
  const me = await requireMember();
  const { subscriptionId } = Body.parse(await req.json());
  return NextResponse.json(await recordSubscription(me, subscriptionId));
});
