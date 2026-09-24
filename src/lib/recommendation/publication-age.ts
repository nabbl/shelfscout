/** Catalog years describe the work's first publication, not a reprint or translation. */
export function publicationAgeEligible(book: { year?: number | null }, maxBookAgeYears: number | null | undefined, currentYear = new Date().getUTCFullYear()): boolean {
    if (maxBookAgeYears == null) return true;
    return typeof book.year === 'number' && Number.isInteger(book.year)
        && book.year >= currentYear - maxBookAgeYears && book.year <= currentYear;
}

export function publicationAgeQuery(query: string, maxBookAgeYears: number | null, currentYear = new Date().getUTCFullYear()): string {
    return maxBookAgeYears === null ? query : `(${query}) AND first_publish_year:[${currentYear - maxBookAgeYears} TO ${currentYear}]`;
}
