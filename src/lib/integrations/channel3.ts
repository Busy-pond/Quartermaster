/**
 * Channel3 product search (https://docs.trychannel3.com).
 * POST https://api.trychannel3.com/v1/search with x-api-key.
 * Live results are cached in Postgres; if Channel3 is off or fails, the
 * adapter falls back to labelled sample products so the demo never breaks.
 */
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { flags } from "@/lib/flags";
import { fixtureSearch } from "./channel3-fixtures";

export interface Product {
  id: string;
  title: string;
  brand: string | null;
  vendor: string; // retailer domain
  priceCents: number;
  currency: string;
  availability: string | null;
  imageUrl: string | null;
  url: string | null;
  source: "channel3" | "fixture";
}

interface C3Offer {
  url?: string;
  domain?: string;
  price?: { price?: number; currency?: string };
  availability?: string;
}
interface C3Product {
  id: string;
  title: string;
  brands?: { id: string; name: string }[];
  images?: { url: string; is_main_image?: boolean }[];
  offers?: C3Offer[];
}

export function normalize(p: C3Product): Product | null {
  const offers = (p.offers ?? []).filter((o) => o.price?.price != null && o.domain);
  // Prefer an in-stock offer, then the cheapest.
  offers.sort((a, b) => Number(b.availability === "InStock") - Number(a.availability === "InStock") || a.price!.price! - b.price!.price!);
  const o = offers[0];
  if (!o) return null;
  const image = p.images?.find((i) => i.is_main_image) ?? p.images?.[0];
  return {
    id: p.id,
    title: p.title,
    brand: p.brands?.[0]?.name ?? null,
    vendor: o.domain!.replace(/^www\./, "").toLowerCase(),
    priceCents: Math.round(o.price!.price! * 100),
    currency: o.price!.currency ?? "USD",
    availability: o.availability ?? null,
    imageUrl: image?.url ?? null,
    url: o.url ?? null,
    source: "channel3",
  };
}

export async function searchProducts(query: string, opts: { maxPrice?: number; limit?: number } = {}): Promise<{ products: Product[]; source: "channel3" | "fixture"; note?: string }> {
  const limit = opts.limit ?? 6;
  if (flags.channel3()) {
    const body = {
      query,
      limit,
      filters: {
        availability: ["InStock"],
        ...(opts.maxPrice ? { price: { max_price: opts.maxPrice } } : {}),
      },
    };
    const key = "c3:" + createHash("sha256").update(JSON.stringify(body)).digest("hex");
    try {
      const cached = await db().query.apiCache.findFirst({ where: eq(schema.apiCache.key, key) });
      if (cached && Date.now() - cached.createdAt.getTime() < 6 * 3600_000) return { products: cached.value as Product[], source: "channel3" };

      const res = await fetch("https://api.trychannel3.com/v1/search", {
        method: "POST",
        headers: { "x-api-key": process.env.CHANNEL3_API_KEY!, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) throw new Error(`Channel3 ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const json = (await res.json()) as { products?: C3Product[] };
      const products = (json.products ?? []).map(normalize).filter((p): p is Product => p !== null).slice(0, limit);
      await db()
        .insert(schema.apiCache)
        .values({ key, value: products })
        .onConflictDoUpdate({ target: schema.apiCache.key, set: { value: products, createdAt: new Date() } });
      return { products, source: "channel3" };
    } catch (e) {
      console.error("Channel3 failed, using samples", e);
      return { products: fixtureSearch(query).slice(0, limit), source: "fixture", note: "Channel3 was unreachable; showing sample products" };
    }
  }
  return { products: fixtureSearch(query).slice(0, limit), source: "fixture", note: "Channel3 is switched off; showing sample products" };
}
