/* eslint-disable @next/next/no-img-element */
"use client";
import type { Candidate } from "@/src/lib/recommendations";
import { BookRatings, specificCaveat, specificBatchReason } from "./book-ratings";
import { settingsRequest } from "./settings-request";
import { AcquisitionRequest } from "./acquisition-request";
import { AcquisitionActivity } from "./acquisition-activity";
import { TasteEditor, FeedbackLog, IdentityReview } from "./taste-editor";
import { useEffect, useState } from "react";
import { BrandIcon } from "./brand-icon";
import { Activity, BookHeart, BookOpen, ChevronRight, Compass, Heart, Library, Search, Settings, Sparkles, Star, X } from "lucide-react";
type Book = {
    id: string;
    workKey?: string;
    title: string;
    author: string;
    year: number | null;
    category: string;
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
    { id: "OL45804W", title: "The Left Hand of Darkness", author: "Ursula K. Le Guin", year: 1969, category: "STRONG FIT", tint: "lilac", cover: "https://covers.openlibrary.org/b/id/12096532-L.jpg", why: "Your love of character-led speculative fiction and quiet moral complexity makes this a natural next step.", caveat: "The pace is contemplative, with more anthropology than action.", tags: ["speculative", "political", "wintry"], ratings: demoRatings(4.09, 4.5) },
    { id: "OL27448W", title: "The Memory Police", author: "Yoko Ogawa", year: 1994, category: "DISCOVERY", tint: "blue", cover: "https://covers.openlibrary.org/b/id/10866503-L.jpg", why: "It shares the eerie restraint you praised in Never Let Me Go, but approaches loss through a stranger, dreamlike lens.", caveat: "Its ambiguity is deliberate; the mystery is not neatly resolved.", tags: ["literary", "dystopian", "Japanese"], ratings: demoRatings(3.74, 4.2) },
    { id: "OL66554W", title: "Piranesi", author: "Susanna Clarke", year: 2020, category: "WILDCARD", tint: "peach", cover: "https://covers.openlibrary.org/b/id/10696499-L.jpg", why: "A compact, architectural mystery that tests your recent interest in place-driven stories without repeating your usual genres.", caveat: "The opening asks you to live with disorientation for a while.", tags: ["mystery", "mythic", "unusual"], ratings: demoRatings(4.21, 4.6) }
];
export function AppShell({ live = false }: {
    live?: boolean;
}) {
    const [active, setActive] = useState("Discover"), [selected, setSelected] = useState<Book | null>(null), [dismissed, setDismissed] = useState<string[]>([]), [requested, setRequested] = useState<string[]>([]), [books, setBooks] = useState<Book[]>(live ? [] : demoBooks), [history, setHistory] = useState<Record<string, unknown>[]>([]), [activities, setActivities] = useState<Record<string, unknown>[]>([]), [notice, setNotice] = useState(live ? "Loading catalog-grounded picks…" : ""), [importState, setImportState] = useState<Record<string, unknown> | null>(null), [collections, setCollections] = useState<{
        id: number;
        name: string;
    }[]>([]), [targetCollectionId, setTargetCollectionId] = useState(""), [mood, setMood] = useState("");
    const [acquisitionBook, setAcquisitionBook] = useState<Book | null>(null);
    const [ratingsNotice, setRatingsNotice] = useState("");
    const [ratingsBusy, setRatingsBusy] = useState(false);
    const [bookOrbitStatus, setBookOrbitStatus] = useState("");
    const [shelfmarkStatus, setShelfmarkStatus] = useState("");
    const [testingBookOrbit, setTestingBookOrbit] = useState(false);
    const [testingShelfmark, setTestingShelfmark] = useState(false);
    const [importBusy, setImportBusy] = useState(false);
    const [importMessage, setImportMessage] = useState("");
    const nav = [["Discover", Compass], ["History", Library], ["Activity", Activity], ["Settings", Settings]] as const;
    async function csrf() { return (await (await fetch("/api/auth/csrf")).json()).token as string; }
    async function loadRecommendations(selectedMood = mood, mode: 'more' | 'refresh' | 'load' = 'refresh') { if (!live)
        return; try {
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
    } }
    async function refreshRatings() {
        setRatingsBusy(true);
        try {
            await settingsRequest('/api/recommendations/ratings', {method:'POST', headers:{'x-csrf-token':await csrf()}});
            setRatingsNotice('Ratings refresh queued. The worker will update these cards.');
        } catch (error) {
            setRatingsNotice(error instanceof Error ? error.message : 'Could not refresh ratings.');
            setRatingsBusy(false);
        }
    }
    async function pollRecommendations() { const r = await fetch('/api/recommendations'); if (!r.ok) {
        setNotice('Could not load recommendations. Check your login.');
        return;
    } const data = await r.json(); if (data.last) {
        const mapped = data.last.items.map((b: Record<string, unknown>, i: number) => ({ id: String(b.editionKey), workKey: String(b.workKey), title: String(b.title), author: String(b.author), year: b.year as number | null, category: String(b.category).toUpperCase(), tint: ['lilac', 'blue', 'peach'][i % 3], cover: String(b.coverUrl || ''), why: String(b.why), caveat: specificCaveat(b.caveat), tags: (b.subjects as string[] || []).slice(0, 3), ratings: b.ratings as Candidate['ratings'], isbn13: b.isbn13 as string | null, language: String(b.language || 'und'), sourceUrl: String(b.sourceUrl || ''), description: String(b.description || ''), series: b.series as string | null, batchReason: specificBatchReason(b.batchReason), evidence: b.evidence as Book['evidence'] }));
        setBooks(mapped);
    }
    const ratingsJob = data.ratingsJob;
    if (ratingsJob) {
        setRatingsBusy(['queued', 'running'].includes(ratingsJob.status));
        setRatingsNotice(ratingsJob.status === 'queued' ? 'Ratings lookup queued.' : ratingsJob.status === 'running' ? 'Looking up Goodreads and Amazon ratings through BookOrbit…' : ratingsJob.status === 'failed' ? ratingsJob.last_error || 'Rating lookup failed. Check BookOrbit and retry.' : 'Ratings lookup finished. Available ratings are shown; book details explain missing values.');
    }
    const a = data.active; setNotice(a?.status === 'queued' || a?.status === 'running' ? `${a.stage}. You can close this page; the worker continues. Last successful picks remain below.` : a?.status === 'failed' ? `${a.error}. Last successful picks retained.` : data.last ? `${data.last.rankingAdapter}. ${data.last.items.length} picks from ${data.last.diagnostics.catalogPool} catalog works. ${(data.last.warnings || []).join(' ')}` : 'No batch yet. Add taste preferences or import history, then choose More picks. Start npm run worker to process jobs.'); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => { const timer = setTimeout(() => void loadRecommendations(mood, "load"), 0); return () => clearTimeout(timer); }, [live]);
    useEffect(() => { if (!live)
        return; const timer = setInterval(() => void pollRecommendations().catch(() => setNotice("Connection lost; your batch is retained.")), 3000); return () => clearInterval(timer); }, [live]);
    useEffect(() => { document.documentElement.dataset.shelfscoutReady = "true"; return () => { delete document.documentElement.dataset.shelfscoutReady; }; }, []);
    useEffect(() => { if (!live)
        return; if (active === "History")
        void fetch("/api/history").then(r => r.json()).then(d => setHistory(d.items || [])); if (active === "Activity")
        void fetch("/api/acquisitions").then(r => r.json()).then(d => setActivities(d.items || [])); }, [active, live]);
    async function feedback(book: Book, action: string) { if (!live) {
        if (['not_interested', 'already_read', 'not_now'].includes(action))
            setDismissed(v => [...v, book.id]);
        return;
    } const reason = ['not_interested', 'not_now'].includes(action) ? window.prompt('Optional reason: which aspect or temporary constraint?', '') || undefined : undefined; try {
        const r = await fetch('/api/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-csrf-token': await csrf() }, body: JSON.stringify({ workKey: book.workKey, action, reason }) });
        if (!r.ok)
            throw new Error('Feedback was not saved');
        if (['not_interested', 'already_read', 'not_now', 'saved'].includes(action))
            setBooks(v => v.filter(b => b.id !== book.id));
        setNotice('Feedback saved. Review or undo it in Settings.');
    }
    catch {
        setNotice('Feedback could not be saved. Please retry.');
    } }
    async function rateHistory(workKey:string,value:string){const r=await fetch('/api/ratings',{method:'PUT',headers:{'Content-Type':'application/json','x-csrf-token':await csrf()},body:JSON.stringify({workKey,rating:value?Number(value):null})});if(r.ok){const data=await(await fetch('/api/history')).json();setHistory(data.items||[]);}else setNotice('Rating could not be saved.');}
    function getBook(book: Book) {
        if (!live) { setRequested(v => [...v, book.id]); setSelected(null); return; }
        setSelected(null);
        setAcquisitionBook(book);
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
 <section className="main-panel"><header className="topbar"><div className="mobile-brand"><BrandIcon size={30}/> ShelfScout</div><label className="search"><Search size={17}/><input aria-label="Search books" placeholder={active === "History" ? "Search your reading history…" : "Open History to search imported books"} disabled={active !== "History" || !live} onChange={e => { if (live && active === "History")
        void fetch(`/api/history?q=${encodeURIComponent(e.target.value)}`).then(r => r.json()).then(d => setHistory(d.items || [])); }}/></label><span className={live ? "live-pill" : "demo-pill"}>{live ? "PRIVATE · LIVE DATA" : "DEMO DATA"}</span></header>
 {active === "Discover" && <><section className="hero"><div><p className="eyebrow">CURATED FOR YOU</p><h1>Your next great read<br />is already out there.</h1><p>Thoughtful picks shaped by what you loved, what you left behind, and what you’re in the mood for now.</p></div><div className="orbit-art" aria-hidden="true"><span className="orbit o1"/><span className="orbit o2"/><span className="orbit o3"/><BookHeart size={37}/></div></section><section className="mood-row"><div><span>Right now, I want…</span>{["atmospheric and thoughtful", "a little strange"].map(value => <button key={value} className={mood === value ? "active" : ""} onClick={() => { setMood(value); void loadRecommendations(value); }}>{value.replace(/^./, c => c.toUpperCase())}</button>)}<button onClick={()=>{setMood("");void loadRecommendations("")}}>Clear mood</button><button className="add" onClick={() => { const value = window.prompt("Describe the mood for this batch", mood)?.trim(); if (value) {
        setMood(value.slice(0, 80));
        void loadRecommendations(value.slice(0, 80));
    } }}>+ Add a mood</button></div><button className="tune" onClick={() => setActive("Settings")}><Settings size={15}/> Tune my taste</button></section><div className="section-heading"><div><h2>This week’s shelf</h2><p>{notice || "Three different ways into something memorable."}</p></div><button onClick={() => void loadRecommendations(mood, "more")}>More picks</button><button onClick={() => void loadRecommendations(mood, "refresh")}>Refresh picks <Sparkles size={15}/></button>{live && <button disabled={ratingsBusy || !books.length} onClick={() => void refreshRatings()}>{ratingsBusy ? "Fetching ratings…" : "Refresh ratings"}</button>}</div>{live && ratingsNotice && <p className="ratings-notice" role="status">{ratingsNotice}</p>}<section className="book-grid">{books.filter(b => !dismissed.includes(b.id)).map(book => <BookCard key={book.id} book={book} requested={requested.includes(book.id)} onGet={() => void getBook(book)} onSave={() => void feedback(book, "saved")} onDismiss={() => void feedback(book, "not_interested")} onDetails={() => setSelected(book)}/>)}</section><section className="signal"><div className="signal-icon"><Star size={22}/></div><div><strong>Your signals are working</strong><p>Dismissals and already-read feedback are excluded from the next real catalog batch.</p></div><button onClick={() => setActive("Settings")}>See what ShelfScout has learned</button></section></>}
 {active === "History" && <DataPage eyebrow="READING HISTORY" title="Your reading life, in one place.">{live ? <div className="history-list">{history.length ? history.map((r, i) => <article key={i}><div><strong>{String(r.title)}</strong><span>{String(r.author || "Unknown author")}</span></div><label>My rating<select aria-label={`Rate ${String(r.title)}`} value={String(r.personal_rating||"")} onChange={e=>void rateHistory(String(r.work_key),e.target.value)}><option value="">Imported / unrated</option>{[1,2,3,4,5].map(n=><option key={n} value={n}>{n} stars</option>)}</select></label><small>{String(r.exclusive_status || "Imported")}</small></article>) : <Empty>No books imported yet. Add your Goodreads CSV in Settings.</Empty>}</div> : <p>History is disabled in demo mode. No personal records are shown.</p>}</DataPage>}
 {active === "Activity" && <DataPage eyebrow="ACTIVITY" title="From request to Ready for Kobo.">{live ? <AcquisitionActivity /> : <p>Demo actions stay in this browser and never acquire books.</p>}</DataPage>}
 {active === "Settings" && <DataPage eyebrow="SETTINGS" title="Connections and preferences.">{live ? <div className="settings-grid"><TasteEditor /><FeedbackLog onSelect={b=>setSelected({id:String(b.editionKey),workKey:String(b.workKey),title:String(b.title),author:String(b.author),year:b.year as number|null,category:String(b.category),tint:"lilac",cover:String(b.coverUrl||""),why:String(b.why),caveat:specificCaveat(b.caveat),tags:b.subjects as string[]||[],ratings:b.ratings as Candidate['ratings'],isbn13:b.isbn13 as string|null,language:String(b.language||"und"),sourceUrl:String(b.sourceUrl||""),description:String(b.description||""),series:b.series as string|null,batchReason:specificBatchReason(b.batchReason),evidence:b.evidence as Book["evidence"]})}/><IdentityReview /><article><h3>Goodreads import</h3><p>Preview every row. Reimports preserve feedback and never trigger downloads.</p><form onSubmit={previewImport}><input type="file" name="file" aria-label="Goodreads CSV" accept=".csv,text/csv" required disabled={importBusy}/><button disabled={importBusy}>Preview import</button></form><p role="status">{importMessage}</p>{importState && <pre>{JSON.stringify(importState, null, 2)}</pre>}{Boolean(importState?.id) && <button onClick={commitImport} disabled={importBusy}>Confirm import</button>}</article><article><h3>BookOrbit</h3><p>BookOrbit imports and manages your library. Only existing Kobo-synced collections are targets.</p><p>Configure BOOKORBIT_USERNAME and BOOKORBIT_PASSWORD on the server for automatic login and token renewal.</p><button onClick={() => void testBookOrbit()} disabled={testingBookOrbit}>{testingBookOrbit ? "Testing BookOrbit…" : "Test connection"}</button><p role="status">{bookOrbitStatus}</p>{collections.length > 0 && <label className="collection-select">Target Kobo collection<select value={targetCollectionId} onChange={e => setTargetCollectionId(e.target.value)}>{collections.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}<h3>Shelfmark</h3><p>Shelfmark searches for releases and delivers completed EPUBs to Book Dock.</p><p>No cookie is needed when Shelfmark authentication is disabled. Otherwise, configure SHELFMARK_COOKIE with an existing session.</p><button onClick={() => void testShelfmark()} disabled={testingShelfmark}>{testingShelfmark ? "Testing Shelfmark…" : "Test Shelfmark connection"}</button><p role="status">{shelfmarkStatus}</p></article><article><h3>Privacy & portability</h3><p>Private reviews remain local unless model sharing is explicitly enabled. Telemetry is off.</p><a href="/api/export">Download portable export</a></article></div> : <p>Setup is disabled in demo mode. Restart with owner credentials and DEMO_MODE=false to connect live data.</p>}</DataPage>}
 </section>{acquisitionBook && <AcquisitionRequest book={acquisitionBook} initialCollectionId={targetCollectionId} onClose={() => setAcquisitionBook(null)} onActivity={() => { setAcquisitionBook(null); setActive("Activity"); }} onRequested={collectionId => { setTargetCollectionId(collectionId); setRequested(current => [...current, acquisitionBook.id]); setAcquisitionBook(null); setActive("Activity"); }}/>} {selected && <Detail book={selected} onClose={() => setSelected(null)} onGet={() => void getBook(selected)} onFeedback={action => { void feedback(selected, action); if (["already_read", "not_interested"].includes(action))
        setSelected(null); }}/>}<nav className="bottom-nav" aria-label="Mobile navigation">{nav.map(([label, Icon]) => <button key={label} onClick={() => setActive(label)} className={active === label ? "active" : ""}><Icon size={19}/><span>{label}</span></button>)}</nav></main>;
}
function BookCard({ book, requested, onGet, onSave, onDismiss, onDetails }: {
    book: Book;
    requested: boolean;
    onGet: () => void;
    onSave: () => void;
    onDismiss: () => void;
    onDetails: () => void;
}) { return <article className="book-card"><div className={`cover-wrap ${book.tint}`}>{book.cover ? <img src={book.cover} alt={`Cover of ${book.title}`}/> : <div className="cover-placeholder"><BookOpen /><small>Cover unavailable</small></div>}<span>{book.category}</span></div><div className="book-content"><p className="book-year">{book.year || "Year unknown"} · {book.tags[0] || "catalog pick"}</p><h3>{book.title}</h3><p className="author">{book.author}</p><p className="why"><Sparkles size={15}/>{book.why}</p>{book.caveat && <p>{book.caveat}</p>}<BookRatings book={book}/><div className="card-actions"><button className="get" disabled={requested} onClick={onGet}>{requested ? "Requested" : "Get book"}<ChevronRight size={16}/></button><button aria-label={`Save ${book.title}`} onClick={onSave}><Heart size={18}/></button><button aria-label={`Dismiss ${book.title}`} onClick={onDismiss}><X size={18}/></button></div><button className="details" onClick={onDetails}>Why this book? <ChevronRight size={14}/></button></div></article>; }
function Detail({ book, onClose, onGet, onFeedback }: {
    book: Book;
    onClose: () => void;
    onGet: () => void;
    onFeedback: (action: string) => void;
}) { return <dialog open className="modal-backdrop"><article className="detail-modal"><button className="modal-close" onClick={onClose} aria-label="Close"><X /></button>{book.cover ? <img src={book.cover} alt=""/> : <div className="detail-cover-placeholder"><BookOpen /><small>Cover unavailable</small></div>}<div><p className="eyebrow">{book.category}</p><h2>{book.title}</h2><p className="author">{book.author} · {book.year} · {book.language || "language unknown"}</p><h4>Why it fits</h4><p>{book.why}</p>{book.batchReason && <><h4>Why this batch</h4><p>{book.batchReason}</p></>}{book.description && <><h4>Catalog description</h4><p>{book.description}</p></>}<p>{book.series ? `Series: ${book.series}` : "Series: unknown"}</p>{book.evidence?.map((e, i) => <details key={i}><summary>{e.preference} · {e.origin}</summary><p>Catalog evidence: {e.catalogQuote}</p><p>Supporting records: {e.support.join(", ")}. Counterexamples: {e.counterexamples.join(", ") || "none recorded"}.</p>{e.interpretation && <p>Model interpretation, not a verified fact: {e.interpretation}</p>}</details>)}{book.caveat && <><h4>What might put you off</h4><p>{book.caveat}</p></>}<div className="tag-row">{book.tags.map(t => <span key={t}>{t}</span>)}</div><BookRatings book={book} details/><div className="feedback-row"><button onClick={() => onFeedback("already_read")}>Already read</button><button onClick={() => onFeedback("not_now")}>Not now</button><button onClick={() => onFeedback("not_interested")}>Not interested</button></div><div className="modal-actions"><button className="get" onClick={onGet}>Get book <ChevronRight size={16}/></button><a href={`https://www.goodreads.com/search?q=${encodeURIComponent(`${book.title} ${book.author}`)}`} target="_blank" rel="noreferrer">Goodreads reviews ↗</a><a href={`https://www.amazon.com/s?k=${encodeURIComponent(book.isbn13 || `${book.title} ${book.author}`)}&i=stripbooks`} target="_blank" rel="noreferrer">Amazon ↗</a>{book.sourceUrl && <a href={book.sourceUrl} target="_blank" rel="noreferrer">Catalog evidence ↗</a>}</div></div></article></dialog>; }
function DataPage({ eyebrow, title, children }: {
    eyebrow: string;
    title: string;
    children: React.ReactNode;
}) { return <section className="data-page"><p className="eyebrow">{eyebrow}</p><h1>{title}</h1>{children}</section>; }
;
function Empty({ children }: {
    children: React.ReactNode;
}) { return <div className="empty-state">{children}</div>; }
