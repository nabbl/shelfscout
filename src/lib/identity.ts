import { createHash } from "node:crypto";

export const normalize = (value?: string | null) => (value || "").normalize("NFKC").trim().toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
export function workKey(title: string, author?: string | null) { return createHash("sha256").update(`${normalize(title)}\0${normalize(author)}`).digest("hex"); }
export function editionKey(input: { isbn13?: string | null; isbn?: string | null; sourceId?: string | null; title: string; author?: string | null }) {
  const identity = input.isbn13 || input.isbn || (input.sourceId ? `goodreads:${input.sourceId}` : `${normalize(input.title)}\0${normalize(input.author)}`);
  return createHash("sha256").update(identity).digest("hex");
}

