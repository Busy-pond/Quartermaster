/**
 * Live price verification, the pure part (Day 10). KERNEL reads the retailer's
 * page; this decides what that means for the order. No I/O.
 */

export const PRICE_TOLERANCE = 0.02; // spec: more than 2% off means the live price is used

export interface LiveCheck {
  url: string;
  verifiedAt: string; // ISO
  livePriceCents: number | null; // what the page shows for one listing
  inStock: boolean | null;
  deliveryText: string | null; // e.g. "Arrives Fri, Oct 31"
  screenshot: string | null; // data:image/jpeg;base64,...
  source: "kernel" | "cache";
  note: string | null;
}

export interface PriceComparison {
  status: "match" | "changed" | "unknown";
  storedCents: number;
  liveCents: number | null;
  /** The price the dry run should use. */
  useCents: number;
  diffPct: number | null;
  message: string;
}

export function comparePrice(storedCents: number, liveCents: number | null): PriceComparison {
  if (liveCents == null || liveCents <= 0)
    return { status: "unknown", storedCents, liveCents: null, useCents: storedCents, diffPct: null, message: "The live price couldn't be read; the search price is used." };
  const diffPct = Math.round(((liveCents - storedCents) / storedCents) * 1000) / 10;
  if (Math.abs(liveCents - storedCents) <= storedCents * PRICE_TOLERANCE)
    return { status: "match", storedCents, liveCents, useCents: storedCents, diffPct, message: "Live price matches the search result." };
  return {
    status: "changed",
    storedCents,
    liveCents,
    useCents: liveCents,
    diffPct,
    message: `The retailer now shows ${(liveCents / 100).toFixed(2)} instead of ${(storedCents / 100).toFixed(2)} (${diffPct > 0 ? "+" : ""}${diffPct}%); the live price is used.`,
  };
}

/** "3 h ago", "2 days ago": a cached check is always shown with its age. */
export function ageLabel(verifiedAt: string, now: Date): string {
  const mins = Math.max(0, Math.round((now.getTime() - Date.parse(verifiedAt)) / 60_000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

/** Only real http(s) retailer pages are opened in the cloud browser. */
export function verifiableUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.)/.test(u.hostname) || u.hostname.endsWith(".example") || u.hostname.endsWith(".invalid")) return null;
    return u.toString();
  } catch {
    return null;
  }
}
