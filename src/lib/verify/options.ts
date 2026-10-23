/**
 * Verification of the agent's search options with KERNEL. The result is stored
 * per option, so the dry run and the proposal read the verified price from the
 * database, never from the model.
 */
import { inArray } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { verifyCacheKey, verifyProduct } from "@/lib/integrations/kernel";
import { ageLabel, comparePrice, verifiableUrl } from "./price";

export interface OptionVerification {
  status: "match" | "changed" | "unknown" | "unverified";
  storedCents: number;
  liveCents: number | null;
  /** The unit price the dry run and the order use. */
  useCents: number;
  verifiedAt: string | null;
  source: "kernel" | "cache" | null;
  inStock: boolean | null;
  deliveryText: string | null;
  message: string;
  /** api_cache key of the full check, which holds the screenshot. */
  checkKey: string | null;
}

type OptionRow = typeof schema.productOptions.$inferSelect;
const optionKey = (optionId: string) => `verify:option:${optionId}`;

export async function verifyOptions(options: OptionRow[]): Promise<Map<string, OptionVerification>> {
  const out = new Map<string, OptionVerification>();
  await Promise.all(
    options.map(async (o) => {
      const url = verifiableUrl(o.url);
      let v: OptionVerification;
      if (!url || o.source === "fixture") {
        v = {
          status: "unverified",
          storedCents: o.priceCents,
          liveCents: null,
          useCents: o.priceCents,
          verifiedAt: null,
          source: null,
          inStock: null,
          deliveryText: null,
          message: o.source === "fixture" ? "Sample product: there is no retailer page to verify." : "No buy link to verify.",
          checkKey: null,
        };
      } else {
        const check = await verifyProduct(url, o.title);
        if (!check) {
          v = { status: "unverified", storedCents: o.priceCents, liveCents: null, useCents: o.priceCents, verifiedAt: null, source: null, inStock: null, deliveryText: null, message: "Live check unavailable (KERNEL off and nothing cached).", checkKey: null };
        } else {
          const c = comparePrice(o.priceCents, check.livePriceCents);
          const cachedNote = check.source === "cache" ? ` (cached check from ${ageLabel(check.verifiedAt, new Date())})` : "";
          v = {
            status: c.status,
            storedCents: o.priceCents,
            liveCents: c.liveCents,
            useCents: c.useCents,
            verifiedAt: check.verifiedAt,
            source: check.source,
            inStock: check.inStock,
            deliveryText: check.deliveryText,
            message: (check.note ?? c.message) + cachedNote,
            checkKey: verifyCacheKey(url),
          };
        }
      }
      await db()
        .insert(schema.apiCache)
        .values({ key: optionKey(o.id), value: v })
        .onConflictDoUpdate({ target: schema.apiCache.key, set: { value: v, createdAt: new Date() } });
      out.set(o.id, v);
    }),
  );
  return out;
}

/** Verifications already stored for these options (options never verified are absent). */
export async function loadVerifications(optionIds: string[]): Promise<Map<string, OptionVerification>> {
  if (optionIds.length === 0) return new Map();
  const rows = await db()
    .select()
    .from(schema.apiCache)
    .where(inArray(schema.apiCache.key, optionIds.map(optionKey)));
  return new Map(rows.map((r) => [r.key.slice("verify:option:".length), r.value as OptionVerification]));
}
