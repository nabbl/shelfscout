/* eslint-disable @next/next/no-img-element */
"use client";
import type { Candidate } from "@/src/lib/recommendations";
import { BookRatings, specificCaveat, specificBatchReason } from "./book-ratings";
import { settingsRequest } from "./settings-request";
import { MoodPicker } from "./mood-picker";
import { SeriesDetails, SeriesDialog } from "./series-details";
import { AcquisitionRequest, type RequestBook } from "./acquisition-request";
import type { SeriesEntry } from "@/src/lib/recommendation/types";
import { recommendationProgress, type RecommendationProgress } from "@/src/lib/recommendation/progress";
import { RegenerateButton } from "./regenerate-button";
import { ReadingHistory } from "./reading-history";
import { BookFeedback } from "./book-feedback";
import { AcquisitionActivity } from "./acquisition-activity";
import { TasteEditor, FeedbackLog, IdentityReview } from "./taste-editor";
import { useEffect, useRef, useState } from "react";
import { BrandIcon } from "./brand-icon";
import { Activity, BookOpen, ChevronRight, Compass, Heart, Library, Settings, Sparkles, X } from "lucide-react";
type Book = {
    id: string;
    workKey?: string;
    title: string;
    author: string;
    year: number | null;
    category: string;
    categoryReason?: string;
    tint: string;
    cover: string;
    why: string;
    caveat: string;
    tags: string[];
    ratings?: Candidate['ratings'];
    isbn13?: string | null;
    language?: string;
    sourceUrl?: string;
    description?: string;
    series?: string | null;
    seriesMemberships?: Candidate['seriesMemberships'];
    batchReason?: string;
    evidence?: {
        preference: string;
        origin: string;
        support: string[];
        counterexamples: string[];
        catalogQuote: string;
        interpretation?: string;
    }[];
};
function demoRatings(goodreads: number, amazon: number): Candidate['ratings'] {
    const rating = (value: number) => ({ rating: value, count: null, status: 'demo', url: '', freshness: 'Illustrative demo data' });
    return { goodreads: rating(goodreads), amazon: rating(amazon) };
}
const demoBooks: Book[] = [
    { id: "OL45804W", title: "The Left Hand of Darkness", author: "Ursula K. Le Guin", year: 1969, category: "MATCHES YOUR INTERESTS", tint: "lilac", cover: "https://covers.openlibrary.org/b/id/12096532-L.jpg", why: "Your love of character-led speculative fiction and quiet moral complexity makes this a natural next step.", caveat: "The pace is contemplative, with more anthropology than action.", tags: ["speculative", "political", "wintry"], ratings: demoRatings(4.09, 4.5) },
    { id: "OL27448W", title: "The Memory Police", author: "Yoko Ogawa", year: 1994, category: "DISCOVERY", tint: "blue", cover: "https://covers.openlibrary.org/b/id/10866503-L.jpg", why: "It shares the eerie restraint you praised in Never Let Me Go, but approaches loss through a stranger, dreamlike lens.", caveat: "Its ambiguity is deliberate; the mystery is not neatly resolved.", tags: ["literary", "dystopian", "Japanese"], ratings: demoRatings(3.74, 4.2) },
    { id: "OL66554W", title: "Piranesi", author: "Susanna Clarke", year: 2020, category: "WILDCARD", tint: "peach", cover: "https://covers.openlibrary.org/b/id/10696499-L.jpg", why: "A compact, architectural mystery that tests your recent interest in place-driven stories without repeating your usual genres.", caveat: "The opening asks you to live with disorientation for a while.", tags: ["mystery", "mythic", "unusual"], ratings: demoRatings(4.21, 4.6) }
];
export function AppShell({ live = false }: {
    live?: boolean;
}) {
    const [active, setActive] = useState("Discover"), [selected, setSelected] = useState<Book | null>(null), [dismissed, setDismissed] = useState<string[]>([]), [requested, setRequested] = useState<string[]>([]), [books, setBooks] = useState<Book[]>(live ? [] : demoBooks), [historyQuery, setHistoryQuery] = useState(""), [activities, setActivities] = useState<Record<string, unknown>[]>([]), [notice, setNotice] = useState(live ? "Loading recommendations…" : ""), [importState, setImportState] = useState<Record<string, unknown> | null>(null), [collections, setCollections] = useState<{
        id: number;
        name: string;
    }[]>([]), [targetCollectionId, setTargetCollectionId] = useState(""), [mood, setMood] = useState("");
    const [feedbackBook, setFeedbackBook] = useState<Book | null>(null);
    const [batchId, setBatchId] = useState("");
    const [batchDetails, setBatchDetails] = useState("");
    const [aiNotice, setAiNotice] = useState("");
    const moodInitialized = useRef(false);
    const [acquisitionBook, setAcquisitionBook] = useState<RequestBook[] | null>(null);
    const [acquisitionSeries, setAcquisitionSeries] = useState<string | undefined>();
    const [seriesOpen, setSeriesOpen] = useState(false);
    const [ratingsNotice, setRatingsNotice] = useState("");
    const [regenerating, setRegenerating] = useState(false);
    const [recommendationJobBusy, setRecommendationJobBusy] = useState(false);
    const [generationProgress, setGenerationProgress] = useState<RecommendationProgress>({ percent: 0, label: "Starting generation" });
    const [bookOrbitStatus, setBookOrbitStatus] = useState("");
    const [shelfmarkStatus, setShelfmarkStatus] = useState("");
    const [testingBookOrbit, setTestingBookOrbit] = useState(false);
    const [testingShelfmark, setTestingShelfmark] = useState(false);
    const [testingModel, setTestingModel] = useState(false);
    const [modelStatus, setModelStatus] = useState("");
    const [importBusy, setImportBusy] = useState(false);
    const [importMessage, setImportMessage] = useState("");
    const nav = [["Discover", Compass], ["History", Library], ["Activity", Activity], ["Settings", Settings]] as const;
    async function csrf() { return (await (await fetch("/api/auth/csrf")).json()).token as string; }
    async function loadRecommendations(selectedMood = mood, mode: 'refresh' | 'load' = 'refresh') { if (!live)
        return; if (mode !== 'load') setRegenerating(true); try {
        if (mode !== 'load') {
            const taste = await (await fetch('/api/taste')).json();
            const r = await fetch('/api/recommendations', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-csrf-token': await csrf() }, body: JSON.stringify({ mood: selectedMood, mode, rereads: taste.profile?.settings?.rereads || false }) });
            if (!r.ok)
                throw new Error('Could not queue recommendations');
        }
        await pollRecommendations();
    }
    catch (error) {
        setNotice(error instanceof Error ? error.message : 'Recommendation request failed');
    } finally { if (mode !== 'load') setRegenerating(false); } }
    async function pollRecommendations() { const r = await fetch('/api/recommendations'); if (!r.ok) {
        setNotice('Could not load recommendations. Check your login.');
        return;
    } const data = await r.json(); if (data.last) {
        const mapped = data.last.items.map((b: Record<string, unknown>, i: number) => ({ id: String(b.editionKey), workKey: String(b.workKey), title: String(b.title), author: String(b.author), year: b.year as number | null, category: String(b.category).toUpperCase(), categoryReason: String(b.categoryReason || ""), tint: ['lilac', 'blue', 'peach'][i % 3], cover: String(b.coverUrl || ''), why: String(b.why), caveat: specificCaveat(b.caveat), tags: (b.subjects as string[] || []).slice(0, 3), ratings: b.ratings as Candidate['ratings'], isbn13: b.isbn13 as string | null, language: String(b.language || 'und'), sourceUrl: String(b.sourceUrl || ''), description: String(b.description || ''), series: b.series as string | null, seriesMemberships: b.seriesMemberships as Book['seriesMemberships'], batchReason: specificBatchReason(b.batchReason), evidence: b.evidence as Book['evidence'] }));
        setBooks(mapped);
    }
    if (data.last) { setBatchId(data.last.id || ""); if (!moodInitialized.current) { setMood(data.last.mood || ""); moodInitialized.current = true; } }
    const ratingsJob = data.ratingsJob;
    if (ratingsJob) {
        setRatingsNotice(ratingsJob.status === 'queued' ? 'Ratings lookup queued.' : ratingsJob.status === 'running' ? 'Looking up Goodreads and Amazon ratings through BookOrbit…' : ratingsJob.status === 'failed' ? ratingsJob.last_error || 'Rating lookup failed. Check BookOrbit and retry.' : 'Ratings lookup finished. Available ratings are shown; book details explain missing values.');
    }
    setBatchDetails(data.last ? `${data.last.rankingAdapter}. ${data.last.items.length} picks from ${data.last.diagnostics.catalogPool} catalog works. ${(data.last.warnings || []).join(' ')}` : '');
    const aiFailures = (data.last?.warnings || []).some((warning: string) => warning.startsWith('AI candidate assessment'));
    const hasBasicPicks = data.last?.items.some((book: { assessmentMode?: string }) => book.assessmentMode === 'literal catalog evidence');
    setAiNotice(aiFailures && (hasBasicPicks || data.last?.diagnostics?.modelAssessed === 0) ? data.last?.diagnostics?.modelAssessed === 0
        ? 'AI matching was unavailable for this batch. These picks use basic catalog matches. Check the AI connection in Settings, then regenerate suggestions.'
        : 'Some picks use basic catalog matches because AI assessment was unavailable. See Recommendation details for the reason.' : '');
    const a = data.active;
    setRecommendationJobBusy(a?.status === 'queued' || a?.status === 'running');
    setGenerationProgress(recommendationProgress(a?.status, a?.stage));
    setNotice(a?.status === 'queued' || a?.status === 'running' ? `${a.stage}. Your current picks remain available.` : a?.status === 'failed' ? `${a.error}. Your previous picks are still available.` : data.last ? data.last.items.length ? '' : 'No matching picks. Regenerate suggestions or adjust your reading preferences in Settings.' : 'No picks yet. Import history or set your preferences, then choose Regenerate suggestions.'); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => { const timer = setTimeout(() => void loadRecommendations(mood, "load"), 0); return () => clearTimeout(timer); }, [live]);
    useEffect(() => { if (!live)
        return; const timer = setInterval(() => void pollRecommendations().catch(() => setNotice("Connection lost; your batch is retained.")), 3000); return () => clearInterval(timer); }, [live]);
    useEffect(() => { document.documentElement.dataset.shelfscoutReady = "true"; return () => { delete document.documentElement.dataset.shelfscoutReady; }; }, []);
    useEffect(() => { if (!live)
        return; if (active === "Activity")
        void fetch("/api/acquisitions").then(r => r.json()).then(d => setActivities(d.items || [])); }, [active, live]);
    async function feedback(book: Book, action: string, suppliedReason?: string) { if (!live) {
        if (['not_interested', 'already_read', 'not_now'].includes(action))
            setDismissed(v => [...v, book.id]);
        return true;
    } const reason = ['not_interested', 'not_now'].includes(action) ? suppliedReason ?? (window.prompt('Optional reason: which aspect or temporary constraint?', '') || undefined) : undefined; try {
        const r = await fetch('/api/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-csrf-token': await csrf() }, body: JSON.stringify({ workKey: book.workKey, action, reason }) });
        if (!r.ok)
            throw new Error('Feedback was not saved');
        if (['not_interested', 'already_read', 'not_now', 'saved'].includes(action))
            setBooks(v => v.filter(b => b.id !== book.id));
        setNotice('Feedback saved. Review or undo it in Settings.');
        return true;
    }
    catch {
        setNotice('Feedback could not be saved. Please retry.');
        return false;
    } }
    function getBook(book: Book) {
        if (!live) { setRequested(v => [...v, book.id]); setSelected(null); return; }
        setSelected(null);
        setAcquisitionSeries(undefined);
        setAcquisitionBook([book]);
    }
    function getSeriesBooks(members: SeriesEntry[], name: string) {
        if (!live || !members.length) return;
        setAcquisitionSeries(name);
        setAcquisitionBook(members.map(member => ({ id: member.key, title: member.title, author: member.author, language: member.language || 'und', cover: member.coverUrl || '', year: member.year ?? null, isbn13: null })));
    }
    async function testBookOrbit() {
        setTestingBookOrbit(true);
        setBookOrbitStatus("Testing BookOrbit connection…");
        try {
            const data = await settingsRequest("/api/integrations/bookorbit");
            setCollections(data.collections);
            setTargetCollectionId(current => data.collections.some((c: { id: number }) => String(c.id) === current) ? current : String(data.collections[0]?.id ?? ""));
            setBookOrbitStatus(data.collections.length ? `BookOrbit connected. ${data.collections.length} Kobo collection(s) available.${data.authentication === "password" ? " Automatic login and token renewal enabled." : ""}` : "BookOrbit connected. No Kobo-synced collections are available. Enable Kobo sync for a collection in BookOrbit, then test again.");
        } catch (error) {
            setCollections([]);
            setTargetCollectionId("");
            setBookOrbitStatus(error instanceof Error ? error.message : "BookOrbit connection failed. Please retry.");
        } finally { setTestingBookOrbit(false); }
    }
    async function testShelfmark() {
        setTestingShelfmark(true);
        setShelfmarkStatus("Testing Shelfmark connection…");
        try {
            await settingsRequest("/api/integrations/shelfmark");
            setShelfmarkStatus("Shelfmark connected. Activity access verified.");
        } catch (error) {
            setShelfmarkStatus(error instanceof Error ? error.message : "Shelfmark connection failed. Please retry.");
        } finally { setTestingShelfmark(false); }
    }
    async function testModel() {
        setTestingModel(true);
        setModelStatus("Testing AI model…");
        try {
            const data = await settingsRequest("/api/integrations/model", { method: "POST", headers: { "x-csrf-token": await csrf() } });
            setModelStatus(`AI model connected. ${data.model} returned a valid response in ${(data.elapsedMs / 1000).toFixed(1)} seconds.`);
        } catch (error) {
            setModelStatus(error instanceof Error ? error.message : "AI connection test failed. Please retry.");
        } finally { setTestingModel(false); }
    }
    async function previewImport(e: React.FormEvent<HTMLFormElement>) {
        e.preventDefault();
        // React clears currentTarget when this handler yields. Capture the file first.
        const formData = new FormData(e.currentTarget);
        setImportBusy(true);
        setImportState(null);
        setImportMessage("Preparing import preview…");
        try {
            const data = await settingsRequest("/api/imports/preview", { method: "POST", headers: { "x-csrf-token": await csrf() }, body: formData });
            setImportState(data);
            setImportMessage("Preview ready. Review the rows before confirming.");
        } catch (error) {
            setImportMessage(error instanceof Error ? error.message : "Import preview failed. Please retry.");
        } finally { setImportBusy(false); }
    }
    async function commitImport() {
        if (!importState?.id) return;
        setImportBusy(true);
        setImportMessage("Importing Goodreads history…");
        try {
            setImportState(await settingsRequest(`/api/imports/${importState.id}/commit`, { method: "POST", headers: { "x-csrf-token": await csrf() } }));
            setImportMessage("Goodreads import complete. Your books are available in History.");
        } catch (error) {
            setImportMessage(error instanceof Error ? error.message : "Import could not be confirmed. Please retry.");
        } finally { setImportBusy(false); }
    }
    return <main className="app-shell"><aside className="sidebar"><div className="brand"><BrandIcon/>ShelfScout</div><nav aria-label="Primary">{nav.map(([label, Icon]) => <button key={label} className={active === label ? "nav-item active" : "nav-item"} onClick={() => setActive(label)}><Icon size={18}/><span>{label}</span>{label === "Activity" && activities.length > 0 && <b className="nav-count">{activities.length}</b>}</button>)}</nav><div className="sidebar-note"><Sparkles size={17}/><div><strong>Taste profile</strong><span>{live ? "Derived from your history" : "Learning from sample history"}</span></div></div><div className="avatar"><span>NB</span><div><strong>Your library</strong><small>Private companion</small></div></div></aside>
 <section className="main-panel"><header className="topbar"><div className="mobile-brand"><BrandIcon size={30}/> ShelfScout</div><span className={live ? "live-pill" : "demo-pill"}>{live ? "PRIVATE · LIVE DATA" : "DEMO DATA"}</span></header>
 {active === "Discover" && <><header className="discover-heading"><h1>Discover</h1><div className="discover-actions"><RegenerateButton busy={regenerating || recommendationJobBusy} progress={recommendationJobBusy ? generationProgress : { percent: 0, label: "Starting generation" }} onClick={() => void loadRecommendations(mood, "refresh")}/></div></header><MoodPicker live={live} value={mood} batchId={batchId} onChange={value => { moodInitialized.current = true; setMood(value); void loadRecommendations(value); }} onSettings={() => setActive("Settings")}/>{notice && <p className="discovery-notice" role="status">{notice}</p>}{aiNotice && <p className="discovery-notice" role="status">{aiNotice}</p>}{batchDetails && <details className="discovery-details"><summary>Recommendation details</summary><p>{batchDetails}</p></details>}{live && ratingsNotice && <p className="ratings-notice" role="status">{ratingsNotice}</p>}<section className="book-grid discovery-books" aria-label="Recommended books">{books.filter(b => !dismissed.includes(b.id)).map(book => <BookCard key={book.id} book={book} requested={requested.includes(book.id)} onGet={() => void getBook(book)} onSave={() => void feedback(book, "saved")} onDismiss={() => setFeedbackBook(book)} onSeries={() => { setSeriesOpen(true); setSelected(book); }} onDetails={() => { setSeriesOpen(false); setSelected(book); }}/>)}</section></>}
 {active === "History" && <DataPage eyebrow="READING HISTORY" title="Your reading life, in one place.">{live ? <ReadingHistory query={historyQuery} onQueryChange={setHistoryQuery}/> : <p>History is disabled in demo mode. No personal records are shown.</p>}</DataPage>}
 {active === "Activity" && <DataPage eyebrow="ACTIVITY" title="From request to Ready for Kobo.">{live ? <AcquisitionActivity /> : <p>Demo actions stay in this browser and never acquire books.</p>}</DataPage>}
 {active === "Settings" && <DataPage eyebrow="SETTINGS" title="Connections and preferences.">{live ? <div className="settings-grid"><TasteEditor /><FeedbackLog onSelect={b=>{setSeriesOpen(false);setSelected({id:String(b.editionKey),workKey:String(b.workKey),title:String(b.title),author:String(b.author),year:b.year as number|null,category:String(b.category),categoryReason:String(b.categoryReason||""),tint:"lilac",cover:String(b.coverUrl||""),why:String(b.why),caveat:specificCaveat(b.caveat),tags:b.subjects as string[]||[],ratings:b.ratings as Candidate['ratings'],isbn13:b.isbn13 as string|null,language:String(b.language||"und"),sourceUrl:String(b.sourceUrl||""),description:String(b.description||""),series:b.series as string|null,seriesMemberships:b.seriesMemberships as Book['seriesMemberships'],batchReason:specificBatchReason(b.batchReason),evidence:b.evidence as Book["evidence"]});}}/><IdentityReview /><article><h3>Goodreads import</h3><p>Preview every row. Reimports preserve feedback and never trigger downloads.</p><form onSubmit={previewImport}><input type="file" name="file" aria-label="Goodreads CSV" accept=".csv,text/csv" required disabled={importBusy}/><button disabled={importBusy}>Preview import</button></form><p role="status">{importMessage}</p>{importState && <pre>{JSON.stringify(importState, null, 2)}</pre>}{Boolean(importState?.id) && <button onClick={commitImport} disabled={importBusy}>Confirm import</button>}</article><article><h3>BookOrbit</h3><p>BookOrbit imports and manages your library. Only existing Kobo-synced collections are targets.</p><p>Configure BOOKORBIT_USERNAME and BOOKORBIT_PASSWORD on the server for automatic login and token renewal.</p><button onClick={() => void testBookOrbit()} disabled={testingBookOrbit}>{testingBookOrbit ? "Testing BookOrbit…" : "Test connection"}</button><p role="status">{bookOrbitStatus}</p>{collections.length > 0 && <label className="collection-select">Target Kobo collection<select value={targetCollectionId} onChange={e => setTargetCollectionId(e.target.value)}>{collections.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}<h3>Shelfmark</h3><p>Shelfmark searches for releases and delivers completed EPUBs to Book Dock.</p><p>No cookie is needed when Shelfmark authentication is disabled. Otherwise, configure SHELFMARK_COOKIE with an existing session.</p><button onClick={() => void testShelfmark()} disabled={testingShelfmark}>{testingShelfmark ? "Testing Shelfmark…" : "Test Shelfmark connection"}</button><p role="status">{shelfmarkStatus}</p><h3>AI model</h3><p>Check that your configured model can respond to a short test request. No reading history is sent.</p><button onClick={() => void testModel()} disabled={testingModel}>{testingModel ? "Testing AI model…" : "Test AI connection"}</button><p role="status">{modelStatus}</p></article><article><h3>Privacy & portability</h3><p>Private reviews remain local unless model sharing is explicitly enabled. Telemetry is off.</p><a href="/api/export">Download portable export</a></article></div> : <p>Setup is disabled in demo mode. Restart with owner credentials and DEMO_MODE=false to connect live data.</p>}</DataPage>}
 </section>{feedbackBook && <BookFeedback key={feedbackBook.id} title={feedbackBook.title} onClose={() => setFeedbackBook(null)} onChoose={(action, reason) => feedback(feedbackBook, action, reason)}/>} {acquisitionBook && <AcquisitionRequest book={acquisitionBook[0]} books={acquisitionBook} seriesName={acquisitionSeries} initialCollectionId={targetCollectionId} onClose={() => setAcquisitionBook(null)} onActivity={() => { setAcquisitionBook(null); setSelected(null); setActive("Activity"); }} onRequested={collectionId => { setTargetCollectionId(collectionId); setRequested(current => [...current, ...acquisitionBook.map(book => book.id)]); setSelected(null); setAcquisitionBook(null); setActive("Activity"); }}/>} {selected && seriesOpen && live && <SeriesDialog key={selected.id} book={selected} onClose={() => setSelected(null)} onGet={getSeriesBooks}/>} {selected && (!seriesOpen || !live) && <Detail key={selected.id} live={live} book={selected} seriesOpen={seriesOpen} onGetSeries={getSeriesBooks} onClose={() => setSelected(null)} onGet={() => void getBook(selected)} onFeedback={action => { void feedback(selected, action); if (["already_read", "not_interested"].includes(action))
        setSelected(null); }}/>}<nav className="bottom-nav" aria-label="Mobile navigation">{nav.map(([label, Icon]) => <button key={label} onClick={() => setActive(label)} className={active === label ? "active" : ""}><Icon size={19}/><span>{label}</span></button>)}</nav></main>;
}
function BookCard({ book, requested, onGet, onSave, onDismiss, onDetails, onSeries }: {
    book: Book;
    requested: boolean;
    onGet: () => void;
    onSave: () => void;
    onDismiss: () => void;
    onDetails: () => void;
    onSeries: () => void;
}) { return <article className="book-card"><button className={`cover-wrap ${book.tint}`} aria-label={`View details for ${book.title}`} title="View book details" onClick={onDetails}>{book.cover ? <img src={book.cover} alt={`Cover of ${book.title}`}/> : <span className="cover-placeholder"><BookOpen /><small>Cover unavailable</small></span>}<span className="cover-category" title={book.categoryReason}>{book.category}</span></button><div className="book-content"><p className="book-year">{book.year || "Year unknown"} · {book.tags[0] || "catalog pick"}</p><h3>{book.title}</h3><p className="author">{book.author}</p><p className="why"><Sparkles size={15}/>{book.why}</p>{book.caveat && <p>{book.caveat}</p>}<BookRatings book={book}/>{book.series && <button className="series-badge" onClick={onSeries}>{book.series}{book.seriesMemberships?.[0]?.position != null ? ` · Book ${book.seriesMemberships[0].position}` : ""}</button>}<div className="card-actions"><button className="get" disabled={requested} onClick={onGet}>{requested ? "Requested" : "Get book"}<ChevronRight size={16}/></button><button aria-label={`Save ${book.title}`} onClick={onSave}><Heart size={18}/></button><button aria-label={`Feedback for ${book.title}`} aria-haspopup="dialog" title="Already read, not now, or not interested" onClick={onDismiss}><X size={18}/></button></div><button className="details" onClick={onDetails}>Why this book? <ChevronRight size={14}/></button></div></article>; }
function Detail({ live, book, onClose, onGet, onFeedback, seriesOpen, onGetSeries }: {
    book: Book;
    onClose: () => void;
    onGet: () => void;
    onFeedback: (action: string) => void;
    seriesOpen: boolean;
    onGetSeries: (books: SeriesEntry[], name: string) => void;
    live: boolean;
}) { return <dialog open className="modal-backdrop"><article className="detail-modal"><button className="modal-close" onClick={onClose} aria-label="Close"><X /></button>{book.cover ? <img src={book.cover} alt=""/> : <div className="detail-cover-placeholder"><BookOpen /><small>Cover unavailable</small></div>}<div><p className="eyebrow">{book.category}</p><h2>{book.title}</h2><p className="author">{book.author} · {book.year} · {book.language || "language unknown"}</p>{book.categoryReason && <p>{book.categoryReason}</p>}<h4>Why it fits</h4><p>{book.why}</p>{book.batchReason && <><h4>Why this batch</h4><p>{book.batchReason}</p></>}{book.description && <><h4>Catalog description</h4><p>{book.description}</p></>}<SeriesDetails key={book.id} autoOpen={seriesOpen} onGet={live ? onGetSeries : undefined} work={book.id} name={book.series} memberships={book.seriesMemberships} live={live}/>{book.evidence?.map((e, i) => <details key={i}><summary>{e.preference} · {e.origin}</summary><p>Catalog evidence: {e.catalogQuote}</p><p>Supporting records: {e.support.join(", ")}. Counterexamples: {e.counterexamples.join(", ") || "none recorded"}.</p>{e.interpretation && <p>Model interpretation, not a verified fact: {e.interpretation}</p>}</details>)}{book.caveat && <><h4>What might put you off</h4><p>{book.caveat}</p></>}<div className="tag-row">{book.tags.map(t => <span key={t}>{t}</span>)}</div><BookRatings book={book} details/><div className="feedback-row"><button onClick={() => onFeedback("already_read")}>Already read</button><button onClick={() => onFeedback("not_now")}>Not now</button><button onClick={() => onFeedback("not_interested")}>Not interested</button></div><div className="modal-actions"><button className="get" onClick={onGet}>Get book <ChevronRight size={16}/></button><a href={`https://www.goodreads.com/search?q=${encodeURIComponent(`${book.title} ${book.author}`)}`} target="_blank" rel="noreferrer">Goodreads reviews ↗</a><a href={`https://www.amazon.com/s?k=${encodeURIComponent(book.isbn13 || `${book.title} ${book.author}`)}&i=stripbooks`} target="_blank" rel="noreferrer">Amazon ↗</a>{book.sourceUrl && <a href={book.sourceUrl} target="_blank" rel="noreferrer">Catalog evidence ↗</a>}</div></div></article></dialog>; }
function DataPage({ eyebrow, title, children }: {
    eyebrow: string;
    title: string;
    children: React.ReactNode;
}) { return <section className="data-page"><p className="eyebrow">{eyebrow}</p><h1>{title}</h1>{children}</section>; }
