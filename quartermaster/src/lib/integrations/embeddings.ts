/**
 * Gemini text embeddings for search (Day 9). Returns null instead of throwing when
 * embeddings are off or the call fails, so callers fall back to keyword search
 * and a purchase or receipt is never blocked by the search index.
 */
import { google } from "@ai-sdk/google";
import { embedMany } from "ai";
import { EMBEDDING_DIMENSIONS } from "@/lib/db/schema";
import { flags } from "@/lib/flags";

export const embeddingModelId = () => process.env.EMBEDDING_MODEL ?? "gemini-embedding-2";

/** "document" for what gets stored, "query" for what gets searched; Gemini tunes the vectors for each side. */
export async function embedTexts(values: string[], kind: "document" | "query"): Promise<number[][] | null> {
  if (!flags.embeddings() || values.length === 0) return null;
  try {
    const { embeddings } = await embedMany({
      model: google.embedding(embeddingModelId()),
      values,
      maxRetries: 1,
      providerOptions: { google: { outputDimensionality: EMBEDDING_DIMENSIONS, taskType: kind === "document" ? "RETRIEVAL_DOCUMENT" : "RETRIEVAL_QUERY" } },
    });
    return embeddings;
  } catch (e) {
    console.error("Embedding failed; using keyword search", e instanceof Error ? e.message : e);
    return null;
  }
}

export async function embedText(value: string, kind: "document" | "query"): Promise<number[] | null> {
  return (await embedTexts([value], kind))?.[0] ?? null;
}
