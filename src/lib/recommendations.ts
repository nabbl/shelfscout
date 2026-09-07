export interface Candidate {
    seriesMemberships?: import('./recommendation/types').SeriesMembership[];
    workKey: string;
    editionKey: string;
    title: string;
    author: string;
    year: number | null;
    isbn13: string | null;
    language: string;
    coverUrl: string | null;
    sourceUrl: string;
    sourceLabel: string;
    subjects: string[];
    category: "strong fit" | "discovery" | "wildcard";
    why: string;
    caveat: string;
    ratings: {
        goodreads: {
            rating: number | null;
            count: number | null;
            status: string;
            url: string;
            freshness: string;
            message?: string;
        };
        amazon: {
            rating: number | null;
            count: number | null;
            status: string;
            url: string;
            freshness: string;
            message?: string;
        };
    };
}
