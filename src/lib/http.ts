import { NextResponse } from "next/server";
import { PayPalError } from "@/lib/paypal/client";
import { Forbidden } from "@/lib/auth/roles";

/** Turns a database failure into one line a person can act on. */
export function friendlyDbError(e: unknown): string {
  const text = [e, (e as { cause?: unknown })?.cause, ((e as { cause?: { cause?: unknown } })?.cause)?.cause]
    .map((x) => (x instanceof Error ? x.message : String(x ?? "")))
    .join(" ");
  if (/DATABASE_URL is not set/.test(text)) return "DATABASE_URL is not set — copy .env.example to .env.local and fill it in, then restart npm run dev.";
  if (/ENOTFOUND|fetch failed|getaddrinfo/i.test(text))
    return "Can't reach the database. Check DATABASE_URL in .env.local (run npm run check:env), then restart npm run dev.";
  if (/password authentication|auth/i.test(text)) return "The database rejected the password in DATABASE_URL. Copy a fresh connection string from Neon.";
  if (/relation .* does not exist/i.test(text)) return "The database has no tables yet — run npm run setup.";
  return "Database error — see the terminal running npm run dev for details.";
}

const isDbError = (e: unknown) => /Failed query|NeonDbError|DATABASE_URL/.test(`${(e as Error)?.message} ${(e as { cause?: Error })?.cause?.name}`);

/** Wraps a route handler: thrown Responses pass through, errors become JSON. */
export function handle<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (e) {
      if (e instanceof Response) return e;
      if (e instanceof Forbidden) return NextResponse.json({ error: e.message }, { status: 403 });
      if (e instanceof PayPalError) {
        console.error("PayPal error", e.status, e.debugId, JSON.stringify(e.details));
        return NextResponse.json({ error: e.message, paypalDebugId: e.debugId }, { status: 502 });
      }
      console.error(e);
      if (isDbError(e)) return NextResponse.json({ error: friendlyDbError(e) }, { status: 503 });
      return NextResponse.json({ error: e instanceof Error ? e.message : "Unexpected error" }, { status: 400 });
    }
  };
}
