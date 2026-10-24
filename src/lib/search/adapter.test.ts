import { describe, expect, it } from "vitest";
import { pickBackend, type SearchBackend } from "./adapter";

const fake = (name: SearchBackend["name"]): SearchBackend => ({
  name,
  searchPolicy: async () => ({ source: name, hits: [] }),
  purchaseHistory: async () => ({ source: name, hits: [] }),
  similarReceipts: async () => [],
});

describe("pickBackend", () => {
  it("uses pgvector by default", () => {
    expect(pickBackend({ pgvector: fake("pgvector") }).name).toBe("pgvector");
    expect(pickBackend({ pgvector: fake("pgvector"), elastic: null }).name).toBe("pgvector");
  });
  it("puts Elastic in front when one is supplied", () => expect(pickBackend({ pgvector: fake("pgvector"), elastic: fake("elastic") }).name).toBe("elastic"));
});
