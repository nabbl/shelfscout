import { bookOrbitAuth } from "./bookorbit-auth";
import { UpstreamHttpError, upstreamConnectionError } from "./upstream-errors";
import { readMetadataRatings, type RatingProvider } from './metadata-ratings';
import { createHash } from "node:crypto";
import { MAX_EPUB_BYTES } from "./acquisition-files";
import { configuredUpstreamUrl } from "./security";

export interface BookCandidate {title:string;author?:string|null;isbn13?:string|null;language:string;providerKey?:string|null;providerId?:string|null;coverUrl?:string|null;publishedYear?:number|null;}
export interface Availability {ownedBookId:number|null;existingRequestId:number|null;existingRequestStatus:string|null;alreadySubscribed:boolean;}
export class BookOrbitClient {
  private base: URL;
  private auth: ReturnType<typeof bookOrbitAuth>;
  constructor(token?: string, base = process.env.BOOKORBIT_URL) {
    this.base = configuredUpstreamUrl(base, "BookOrbit");
    this.auth = bookOrbitAuth(this.base, token);
  }
  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    const url = new URL(`${this.base.pathname.replace(/\/$/, '')}/api/v1${path}`, this.base.origin);
    const send = (token?: string) => {
      const headers = new Headers(init.headers);
      if (token) headers.set('Authorization', `Bearer ${token}`);
      return fetch(url, { ...init, headers, redirect: 'error', cache: 'no-store' });
    };
    const token = await this.auth.token();
    const response = await send(token);
    if (response.status !== 401 || this.auth.mode !== 'password') return response;
    await response.body?.cancel();
    // A confirmed authentication rejection can be retried once. Never replay on a
    // network failure, timeout, permission denial or uncertain mutation outcome.
    const renewedToken = await this.auth.token(token);
    const retry = await send(renewedToken);
    if (retry.status === 401) this.auth.reject();
    return retry;
  }
  private async call<T>(path: string, init: RequestInit = {}) {
    try {
      const response = await this.request(path, { ...init, headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...init.headers }, signal: AbortSignal.timeout(45_000) });
      if (!response.ok) throw new UpstreamHttpError('BookOrbit', path, response.status);
      if (response.status === 204) return undefined as T;
      return await response.json() as T;
    } catch (error) { throw upstreamConnectionError('BookOrbit', error); }
  }
  test(){return this.call<unknown>("/book-dock/summary");}
  ratingProviders(){return this.call<Array<{key:string;label:string}>>("/metadata-fetch/providers");}
  async searchRatings(book: {title:string;author:string;isbn13?:string|null}, providers: RatingProvider[]) {
    const params = new URLSearchParams({ title: book.title, author: book.author.slice(0,255), providers: providers.join(','), mediaKind: 'ebook' });
    if (book.isbn13) params.set('isbn', book.isbn13);
    const path = '/metadata-fetch/stream';
    try {
      const response = await this.request(`${path}?${params}`, {
        headers: { Accept: 'text/event-stream' },
        redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(70_000),
      });
      if (!response.ok) throw new UpstreamHttpError('BookOrbit', path, response.status);
      return await readMetadataRatings(response);
    } catch (error) { throw upstreamConnectionError('BookOrbit', error); }
  }
  collections(){return this.call<Array<{id:number;name:string;syncToKobo:boolean;bookCount?:number}>>("/collections");}
  availability(c:BookCandidate){return this.call<Availability[]>("/book-requests/availability",{method:"POST",body:JSON.stringify({items:[{title:c.title,author:c.author||undefined,isbn13:c.isbn13||undefined,providerKey:c.providerKey||undefined,providerId:c.providerId||undefined,mediaKind:"ebook"}]})}).then(v=>v[0]);}
  listRequests(){return this.call<{items:Array<Record<string,unknown>>}>("/book-requests?size=100&sort=updatedAt&direction=desc");}
  requestStatus(id:string|number){return this.call<Record<string,unknown>>(`/book-requests/${id}`);}
  book(id:string|number){return this.call<Record<string,unknown>>(`/books/${id}`);}
  addToCollection(collectionId:string|number,bookId:string|number){return this.call(`/collections/${collectionId}/books`,{method:"POST",body:JSON.stringify({bookIds:[Number(bookId)]})});}
  collectionBooks(collectionId:string|number,page=0){return this.call<{items:Array<{id:number}>;total:number}>(`/collections/${collectionId}/books?page=${page}&size=100`);}
  async hasCollectionBook(collectionId:string,bookId:string){
    for(let page=0;page<1000;page++) {const result=await this.collectionBooks(collectionId,page);if(result.items.some(b=>String(b.id)===bookId))return true;if(result.items.length<100 || (page+1)*100>=result.total)return false;}
    throw new Error("Collection membership exceeded the pagination limit.");
  }
  dockSettings(){return this.call<{bookDockPath:string;autoFinalizeEnabled:boolean}>("/book-dock/settings");}
  async dockFiles(){
    const files:DockFile[]=[];
    for(let page=1;page<=1000;page++){const result=await this.call<{items:DockFile[];total:number}>(`/book-dock/files?page=${page}&limit=100&sort=createdAt&order=asc`);files.push(...result.items);if(result.items.length<100 || files.length>=result.total)return files;}
    throw new Error("Book Dock listing exceeded the pagination limit.");
  }
  dockFile(id:number){return this.call<DockFile>(`/book-dock/files/${id}`);}
  rescan(){return this.call<void>("/book-dock/rescan",{method:"POST"});}
  previewImport(fileId:number,libraryId:number,folderId:number){return this.call<{truncated:boolean;items:Array<{fileId:number;status:string;existingBookId?:number}>}>("/book-dock/finalize/preview",{method:"POST",body:JSON.stringify({fileIds:[fileId],overrides:[{fileId,libraryId,folderId}]})});}
  finalizeImport(fileId:number,libraryId:number,folderId:number){return this.call<{results:Array<{fileId:number;success:boolean;bookId?:number;existingBookId?:number}>}>("/book-dock/finalize",{method:"POST",body:JSON.stringify({fileIds:[fileId],overrides:[{fileId,libraryId,folderId}]})});}
  async fileDigest(fileId:number){
    try {
      const response=await this.request(`/books/files/${fileId}/download`,{signal:AbortSignal.timeout(90_000)});
      if(!response.ok || !response.body)throw new Error("unavailable");
      const hash=createHash("sha256");let size=0;const reader=response.body.getReader();
      try{while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_EPUB_BYTES)throw new Error("size limit");hash.update(value);}}finally{await reader.cancel();reader.releaseLock();}
      return {sha256:hash.digest("hex"),size};
    }catch{throw new Error("Could not verify the imported EPUB bytes. Check BookOrbit library_download permission and connection.");}
  }
}

export interface DockFile {id:number;fileName:string;fileSize:number|null;format:string|null;status:string;embeddedMetadata:Record<string,unknown>|null;selectedMetadata:Record<string,unknown>|null;unitFiles:unknown[];}
