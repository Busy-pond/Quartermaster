import { describe, expect, it } from "vitest";
import { unitsPerListing } from "./units";

// Decision D34: quantities are read from listing titles in code, never by the model.
describe("unitsPerListing", () => {
  const cases: [string, number][] = [
    ["Stainless steel water bottle 20 oz, bulk pack of 24", 24],
    ["Box of 100 nitrile gloves", 100],
    ["Case of 12 water bottles", 12],
    ["Nitrile-coated work gloves, 12 pairs", 12],
    ["Trash bags 50 count", 50],
    ["Paper towels 6-pack", 6],
    ["Zip ties 200 pcs", 200],
    ["Safety vests, 10 pieces", 10],
    ["Duct tape 3 rolls", 3],
    ["Spring water 24 bottles", 24],
    ["Heavy-duty trash bags (100)", 100],
    ["AA batteries x24", 24],
    ["Reusable 24 oz water bottle, BPA-free (single)", 1],
    ["Heavy-duty cleanup gloves, cut resistant (pair)", 1],
    ["Collapsible silicone water bottle 18 oz", 1],
    ["Folding table, 6 ft", 1],
  ];
  it.each(cases)("%s → %i", (title, units) => {
    expect(unitsPerListing(title)).toBe(units);
  });
});
