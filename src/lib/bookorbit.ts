import { configuredUpstreamUrl } from "./security";

export interface BookCandidate {title:string;author?:string|null;isbn13?:string|null;language:string;providerKey?:string|null;providerId?:string|null;coverUrl?:string|null;publishedYear?:number|null;}
export interface Availability {ownedBookId:number|null;existingRequestId:number|null;existingRequestStatus:string|null;alreadySubscribed:boolean;}
export class BookOrbitClient {
  private base:URL; constructor(private token=process.env.BOOKORBIT_TOKEN,base=process.env.BOOKORBIT_URL){this.base=configuredUpstreamUrl(base,"BookOrbit");}
  private async call<T>(path:string,init:RequestInit={}){const url=new URL(`${this.base.pathname}/api/v1${path}`,this.base.origin);const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),15_000);try{const r=await fetch(url,{...init,headers:{Accept:"application/json","Content-Type":"application/json",...(this.token?{Authorization:`Bearer ${this.token}`}:{}) ,...init.headers},signal:controller.signal,cache:"no-store"});if(!r.ok)throw new Error(`BookOrbit ${r.status}: ${(await r.text()).slice(0,300)}`);return await r.json() as T;}finally{clearTimeout(timer);}}
  test(){return this.call<unknown>("/book-requests/summary");}
  collections(){return this.call<Array<{id:number;name:string;syncToKobo:boolean;bookCount?:number}>>("/collections");}
  availability(c:BookCandidate){return this.call<Availability[]>("/book-requests/availability",{method:"POST",body:JSON.stringify({items:[{title:c.title,author:c.author||undefined,isbn13:c.isbn13||undefined,providerKey:c.providerKey||undefined,providerId:c.providerId||undefined,mediaKind:"ebook"}]})}).then(v=>v[0]);}
  listRequests(){return this.call<{items:Array<Record<string,unknown>>}>("/book-requests?size=100&sort=updatedAt&direction=desc");}
  request(c:BookCandidate){return this.call<{request:Record<string,unknown>;created:boolean;attached:boolean}>("/book-requests",{method:"POST",body:JSON.stringify({title:c.title,authors:c.author?[c.author]:[],isbn13:c.isbn13||undefined,language:c.language,providerKey:c.providerKey||undefined,providerId:c.providerId||undefined,coverUrl:c.coverUrl||undefined,publishedYear:c.publishedYear||undefined,mediaKind:"ebook",preferredFormats:["epub"]})});}
  requestStatus(id:string|number){return this.call<Record<string,unknown>>(`/book-requests/${id}`);}
  book(id:string|number){return this.call<Record<string,unknown>>(`/books/${id}`);}
  addToCollection(collectionId:string|number,bookId:string|number){return this.call(`/collections/${collectionId}/books`,{method:"POST",body:JSON.stringify({bookIds:[Number(bookId)]})});}
  collectionBooks(collectionId:string|number){return this.call<{items:Array<{id:number}>}>(`/collections/${collectionId}/books?size=100`);}
}
