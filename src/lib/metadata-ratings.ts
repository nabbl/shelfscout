import { z } from 'zod';

export const ratingProviders = ['goodreads', 'amazon'] as const;
export type RatingProvider = typeof ratingProviders[number];
const candidateSchema = z.object({
  provider: z.enum(ratingProviders), providerId: z.string().min(1).max(200),
  title: z.string().max(500).optional(), authors: z.array(z.string().max(255)).max(30).optional(),
  isbn10: z.string().optional(), isbn13: z.string().optional(), sourceUrl: z.string().optional(),
  communityRating: z.number().min(0).max(5).optional(), communityRatingCount: z.number().int().nonnegative().optional(),
});
export type RatingCandidate = z.infer<typeof candidateSchema>;
export type MetadataRatings = { candidates: RatingCandidate[]; failures: Partial<Record<RatingProvider, string>> };

/** Nest's metadata endpoint streams candidate messages and named provider-status events. */
export async function readMetadataRatings(response: Response): Promise<MetadataRatings> {
  if (!response.headers.get('content-type')?.includes('text/event-stream') || !response.body) throw new Error('BookOrbit metadata response is not an event stream.');
  const result: MetadataRatings = { candidates: [], failures: {} };
  const reader = response.body.getReader(); const decoder = new TextDecoder();
  let pending = '', bytes = 0;
  const consume = (block: string) => {
    const lines = block.split('\n');
    const event = lines.find(line => line.startsWith('event:'))?.slice(6).trim();
    const data = lines.filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
    if (!data) return;
    let value;
    try { value = JSON.parse(data); } catch { throw new Error('Invalid BookOrbit metadata event.'); }
    if (event === 'provider-status') {
      if (ratingProviders.includes(value.provider) && ['failed', 'timeout', 'throttled'].includes(value.outcome)) result.failures[value.provider as RatingProvider] = value.outcome;
    } else {
      const parsed = candidateSchema.safeParse(value);
      if (parsed.success) result.candidates.push(parsed.data);
      if (result.candidates.length > 200) throw new Error('BookOrbit metadata result limit exceeded.');
    }
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 2 * 1024 * 1024) throw new Error('BookOrbit metadata response exceeded the size limit.');
      pending += decoder.decode(value, { stream: true });
      let boundary;
      while ((boundary = /\r?\n\r?\n/.exec(pending))) {
        consume(pending.slice(0, boundary.index).replaceAll('\r\n', '\n'));
        pending = pending.slice(boundary.index + boundary[0].length);
      }
    }
  } catch (error) {
    if (!(error instanceof Error) || !['TimeoutError', 'AbortError'].includes(error.name)) throw error;
    for (const provider of ratingProviders) result.failures[provider] ||= 'timeout';
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  return result;
}
