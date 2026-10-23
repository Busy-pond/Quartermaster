import { NextResponse } from "next/server";
import { SubscriptionBody } from "@/lib/api/schemas";
import { handle } from "@/lib/http";
import { requireMember } from "@/lib/session";
import { recordSubscription } from "@/lib/funding/service";

const Body = SubscriptionBody;

/** Called by /join after the member approves in PayPal. The server checks the subscription with PayPal itself. */
export const POST = handle(async (req: Request) => {
  const me = await requireMember();
  const { subscriptionId } = Body.parse(await req.json());
  return NextResponse.json(await recordSubscription(me, subscriptionId));
});
