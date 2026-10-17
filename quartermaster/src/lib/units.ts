/**
 * Reads how many units one listing contains from its title ("pack of 24",
 * "12 pairs", "50 count", "(100)"). Deterministic on purpose: quantities stay
 * out of the model's hands. Unknown formats fall back to 1, which errs toward
 * buying more listings — the budget checks then catch it.
 */
const PATTERNS: RegExp[] = [
  /\b(?:pack|box|case|set|bag|carton)\s+of\s+(\d{1,5})\b/i, // pack of 24
  /\b(\d{1,5})\s*-?\s*(?:pack|pk|ct|count|pcs?|pieces?|pairs?|rolls?|bottles?|cans?|units?|sheets?|bags?)\b/i, // 12 pairs, 50 count, 6-pack
  /\(\s*(\d{1,5})\s*\)/, // (100)
  /\b(?:x|×)\s*(\d{1,5})\b/i, // x24
];

export function unitsPerListing(title: string): number {
  for (const re of PATTERNS) {
    const m = title.match(re);
    if (m) {
      const n = Number(m[1]);
      if (Number.isInteger(n) && n > 0) return n;
    }
  }
  return 1;
}
