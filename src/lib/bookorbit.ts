import { createHash } from "node:crypto";
import { MAX_EPUB_BYTES } from "./acquisition-files";
import { configuredUpstreamUrl } from "./security";

export interface BookCandidate {title:string;author?:string|null;isbn13?:string|null;language:string;providerKey?:string|null;providerId?:string|null;coverUrl?:string|null;publishedYear?:number|null;}
export interface Availability {ownedBookId:number|null;existingRequestId:number|null;existingRequestStatus:string|null;alreadySubscribed:boolean;}
export class BookOrbitClient {
  private base:URL; constructor(private token=process.env.BOOKORBIT_TOKEN,base=process.env.BOOKORBIT_URL){this.base=configuredUpstreamUrl(base,"BookOrbit");}
  private async call<T>(path:string,init:RequestInit={}){const url=new URL(`${this.base.pathname.replace(/\/$/, "")}/api/v1${path}`,this.base.origin);const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),15_000);try{const r=await fetch(url,{...init,headers:{Accept:"application/json","Content-Type":"application/json",...(this.token?{Authorization:`Bearer ${this.token}`}:{}) ,...init.headers},signal:controller.signal,redirect:"error",cache:"no-store"});if(!r.ok)throw new Error(`BookOrbit HTTP ${r.status}. Check connection and permissions.`);if(r.status===204)return undefined as T;return await r.json() as T;}catch(error){if(error instanceof Error && error.message.startsWith("BookOrbit HTTP"))throw error;throw new Error("BookOrbit connection timed out or returned an invalid response.");}finally{clearTimeout(timer);}}
  test(){return this.call<unknown>("/book-dock/summary");}
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
      const response=await fetch(new URL(`${this.base.pathname.replace(/\/$/, "")}/api/v1/books/files/${fileId}/download`,this.base.origin),{headers:this.token?{Authorization:`Bearer ${this.token}`}:{},redirect:"error",signal:AbortSignal.timeout(60000),cache:"no-store"});
      if(!response.ok || !response.body)throw new Error("unavailable");
      const hash=createHash("sha256");let size=0;const reader=response.body.getReader();
      try{while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_EPUB_BYTES)throw new Error("size limit");hash.update(value);}}finally{await reader.cancel();reader.releaseLock();}
      return {sha256:hash.digest("hex"),size};
    }catch{throw new Error("Could not verify the imported EPUB bytes. Check BookOrbit library_download permission and connection.");}
  }
}

export interface DockFile {id:number;fileName:string;fileSize:number|null;format:string|null;status:string;embeddedMetadata:Record<string,unknown>|null;selectedMetadata:Record<string,unknown>|null;unitFiles:unknown[];}
