import { NextResponse } from "next/server";
import { getClientToken } from "@/lib/paypal/client";
import { handle } from "@/lib/http";

export const dynamic = "force-dynamic";

/**
 * PayPal binds the client token to the page's domain, but rejects localhost and
 * IP addresses ("invalid_domain"), so local development gets an unbound token.
 * The domain is taken from the request so a cloudflared or Render URL works
 * even when APP_URL still says localhost.
 */
function tokenDomains(req: Request): string[] {
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? new URL(process.env.APP_URL ?? req.url).host;
  const hostname = host.split(",")[0].trim().replace(/:\d+$/, "");
  const local = hostname === "localhost" || hostname.endsWith(".localhost") || /^[\d.]+$/.test(hostname) || hostname.includes(":");
  return local ? [] : [hostname];
}

export const GET = handle(async (req: Request) => NextResponse.json({ accessToken: await getClientToken(tokenDomains(req)) }));
