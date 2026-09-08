export interface Candidate {
    seriesMemberships?: import('./recommendation/types').SeriesMembership[];
    workKey: string;
    editionKey: string;
    title: string;
    author: string;
    year: number | null;
    isbn13: string | null;
    language: string;
    languages?: string[];
    coverUrl: string | null;
    sourceUrl: string;
    sourceLabel: string;
    subjects: string[];
    category: "strong fit" | "matches your interests" | "discovery" | "wildcard";
    categoryReason?: string;
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
