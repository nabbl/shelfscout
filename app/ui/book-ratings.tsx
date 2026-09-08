import type { Candidate } from '@/src/lib/recommendations';

type RatedBook = { title: string; author: string; isbn13?: string | null; ratings?: Candidate['ratings'] };

export function BookRatings({ book, details = false }: { book: RatedBook; details?: boolean }) {
  const links = {
    goodreads: `https://www.goodreads.com/search?q=${encodeURIComponent(`${book.title} ${book.author}`)}`,
    amazon: `https://www.amazon.com/s?k=${encodeURIComponent(book.isbn13 || `${book.title} ${book.author}`)}&i=stripbooks`,
  };
  return <div className="ratings">{(['goodreads', 'amazon'] as const).map(source => {
    const rating = book.ratings?.[source];
    const available = typeof rating?.rating === 'number' && rating.rating > 0 && rating.rating <= 5;
    const label = source === 'goodreads' ? 'Goodreads' : 'Amazon';
    const note = available ? rating?.status === 'import_snapshot' ? 'CSV snapshot' : rating?.status === 'demo' ? 'Demo rating' : rating?.status === 'stale' ? 'Cached rating' : null : 'Rating unavailable';
    return <div className="rating-source" key={source}>
      <a href={rating?.url || links[source]} target="_blank" rel="noreferrer" aria-label={`${label} reviews for ${book.title}`}>
        <span className="rating-name">{label}</span>
        {available ? <span className="rating-score">
          <span className="rating-segments" role="img" aria-label={`${rating!.rating!.toFixed(2)} out of 5`}>
            {Array.from({ length: 5 }, (_, index) => <span className="rating-segment" key={index}>
              <span className="rating-fill" style={{ width: `${Math.max(0, Math.min(1, rating!.rating! - index)) * 100}%` }} />
            </span>)}
          </span>
          <strong>{rating!.rating!.toFixed(2)}</strong>
        </span> : <strong>Read reviews ↗</strong>}
      </a>
      {note && <small>{note}</small>}
      {details && available && rating?.message && <small>{rating.message}</small>}
      {details && <small>{available
        ? `${rating?.count == null ? 'Rating count unknown' : `${rating.count.toLocaleString()} ratings`}. ${rating?.freshness?.replace(/ via BookOrbit/gi, '') || 'Rating date unknown'}.`
        : rating?.message || 'Ratings are looked up automatically for new suggestions when BookOrbit is connected.'}</small>}
    </div>;
  })}</div>;
}

// Remove boilerplate from previously saved batches as well as new results.
export function specificCaveat(value: unknown) {
  const text = typeof value === 'string' ? value : '';
  return text === 'No specific conflict found in available evidence. Unmentioned traits remain unknown.' ? '' : text;
}

export function specificBatchReason(value: unknown) {
  const text = typeof value === 'string' ? value : '';
  return text === 'Supported preferences with no evidenced tension; selected with author, series and theme diversity.' ? '' : text;
}
