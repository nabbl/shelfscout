import { z } from "zod";
export const preferenceSchema = z.object({ id: z.string().max(100), dimension: z.enum(['theme', 'prose', 'pacing', 'character', 'tone', 'structure', 'length', 'ambiguity', 'subject', 'author']), value: z.string().min(1).max(120), direction: z.enum(['prefer', 'avoid']), origin: z.enum(['explicit', 'inferred', 'model']), confidence: z.enum(['tentative', 'supported', 'conflicting']), support: z.array(z.string()).max(16), counterexamples: z.array(z.string()).max(16) });
export type Preference = z.infer<typeof preferenceSchema>;
export const settingsSchema = z.object({ preferences: z.array(preferenceSchema).max(60).default([]), disabled: z.array(z.string().max(100)).max(100).default([]), includeReviews: z.boolean().default(false), rereads: z.boolean().default(false), allowSeries: z.boolean().default(true), hiddenMoods: z.array(z.string().max(80)).max(100).default([]) });
export type TasteSettings = z.infer<typeof settingsSchema>;
export type Evidence = {
    catalog?: {key:string;description:string;subjects:string[];sourceUrl:string};
    id: string;
    workKey: string;
    title: string;
    author: string;
    rating: number | null;
    status: string;
    shelves: string[];
    date: string | null;
    review?: string;
    reason?: string;
};
export type Profile = {
    sourceVersion?: string;
    version: string;
    preferences: Preference[];
    evidence: Evidence[];
    settings: TasteSettings;
    unknown: string[];
};
export type SeriesMembership = { key: string | null; name: string; position: number | null };
export type SeriesEntry = { key: string; title: string; author: string; position: number | null; sourceUrl: string; read?: boolean };
export type CatalogBook = {
    key: string;
    title: string;
    author: string;
    year: number | null;
    isbns: string[];
    language: string;
    coverUrl: string | null;
    subjects: string[];
    description: string;
    series: string | null;
    seriesMemberships?: SeriesMembership[];
    strategies: string[];
};
export type Assessment = {
    key: string;
    matches: {
        preferenceId: string;
        quote: string;
        field: 'subjects' | 'description';
        interpretation: string;
    }[];
    risks: {
        preferenceId: string;
        quote: string;
        field: 'subjects' | 'description';
        interpretation: string;
    }[];
    mood: {
        quote: string;
        field: 'subjects' | 'description';
        interpretation: string;
    } | null;
};
