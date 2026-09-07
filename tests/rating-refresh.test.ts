import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDatabase } from '../src/lib/db';
import { BookOrbitClient } from '../src/lib/bookorbit';
import { readMetadataRatings, type RatingCandidate } from '../src/lib/metadata-ratings';
import { matchRating, queueRatingRefresh, refreshBatchRatings } from '../src/lib/rating-refresh';
import { withStoredRatings } from '../src/lib/ratings';
import { queueBatch } from '../src/lib/recommendation/engine';
import type { Candidate } from '../src/lib/recommendations';

const book: Candidate = { workKey:'work-123',editionKey:'/works/OL1W',title:'Piranesi',author:'Susanna Clarke',year:2020,isbn13:null,language:'eng',coverUrl:null,sourceUrl:'https://openlibrary.org/works/OL1W',sourceLabel:'Open Library',subjects:[],category:'discovery',why:'Fixture',caveat:'',ratings:{goodreads:{rating:null,count:null,status:'not_retrieved',url:'https://www.goodreads.com/search?q=Piranesi',freshness:'Unknown'},amazon:{rating:null,count:null,status:'not_retrieved',url:'https://www.amazon.com/s?k=Piranesi',freshness:'Unknown'}} };
const goodreads: RatingCandidate = {provider:'goodreads',providerId:'50202953',title:book.title,authors:[book.author],communityRating:4.2,communityRatingCount:573387,sourceUrl:'https://www.goodreads.com/book/show/50202953-piranesi'};
const amazon: RatingCandidate = {...goodreads,provider:'amazon',providerId:'B123',communityRating:4.4,sourceUrl:'https://www.amazon.com/dp/B123?tag=test'};
function fixture() { const db=createDatabase(':memory:');const id=queueBatch(db,{mood:'',mode:'refresh',rereads:false});db.prepare("UPDATE recommendation_batches SET status='complete',result_json=?,completed_at=? WHERE id=?").run(JSON.stringify({items:[book]}),new Date().toISOString(),id);return {db,id}; }
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});

describe('BookOrbit rating retrieval',()=>{
 it('parses fragmented SSE messages and provider failures',async()=>{
  const wire=`data: ${JSON.stringify(goodreads)}\r\n\r\nevent: provider-status\r\ndata: {"provider":"amazon","outcome":"throttled"}\r\n\r\n`;
  const stream=new ReadableStream({start(c){for(let i=0;i<wire.length;i+=7)c.enqueue(new TextEncoder().encode(wire.slice(i,i+7)));c.close();}});
  expect(await readMetadataRatings(new Response(stream,{headers:{'content-type':'text/event-stream'}}))).toEqual({candidates:[goodreads],failures:{amazon:'throttled'}});
 });
 it('rejects login HTML and oversized streams',async()=>{
  await expect(readMetadataRatings(new Response('<html>login</html>'))).rejects.toThrow('not an event stream');
  await expect(readMetadataRatings(new Response('x'.repeat(2*1024*1024+1),{headers:{'content-type':'text/event-stream'}}))).rejects.toThrow('size limit');
 });
 it('requires title and author identity, rejects bundles, wrong ISBNs and unsafe source links',()=>{
  expect(matchRating(book,[{...goodreads,authors:['Luigi Ficacci']},{...goodreads,title:'Piranesi collection set'},goodreads],'goodreads')).toEqual(goodreads);
  expect(matchRating({...book,isbn13:'9781234567890'},[goodreads],'goodreads')).toBeUndefined();
  expect(matchRating(book,[{...goodreads,sourceUrl:'https://goodreads.com.evil.test/book'}],'goodreads')).toBeUndefined();
  expect(matchRating(book,[{...goodreads,communityRating:8}],'goodreads')).toBeUndefined();
 });
 it('sends read-only metadata queries and configured credentials without following redirects',async()=>{
  const fetchMock=vi.fn().mockResolvedValue(new Response(`data: ${JSON.stringify(goodreads)}\n\n`,{headers:{'content-type':'text/event-stream'}}));vi.stubGlobal('fetch',fetchMock);
  await new BookOrbitClient('secret','http://bookorbit.test/base').searchRatings(book,['goodreads','amazon']);
  const [url,options]=fetchMock.mock.calls[0];expect(url.pathname).toBe('/base/api/v1/metadata-fetch/stream');expect(url.searchParams.get('providers')).toBe('goodreads,amazon');expect(options.method).toBeUndefined();expect(options.redirect).toBe('error');expect(new Headers(options.headers).get('authorization')).toBe('Bearer secret');
 });
 it('caches both providers, keeps stale success on failure, and supports explicit refresh',async()=>{
  const {db,id}=fixture();const client=new BookOrbitClient('secret','http://bookorbit.test');vi.spyOn(client,'ratingProviders').mockResolvedValue([{key:'goodreads',label:'Goodreads'},{key:'amazon',label:'Amazon'}]);
  const search=vi.spyOn(client,'searchRatings').mockResolvedValue({candidates:[goodreads,amazon],failures:{}});
  await refreshBatchRatings(db,id,false,client);
  let ratings=withStoredRatings(db,book).ratings;expect(ratings.goodreads.rating).toBe(4.2);expect(ratings.goodreads.count).toBe(573387);expect(ratings.amazon.rating).toBe(4.4);expect(ratings.amazon.url).toBe('https://www.amazon.com/dp/B123');
  await refreshBatchRatings(db,id,false,client);expect(search).toHaveBeenCalledTimes(1);
  search.mockResolvedValue({candidates:[],failures:{goodreads:'throttled',amazon:'timeout'}});
  await refreshBatchRatings(db,id,true,client);ratings=withStoredRatings(db,book).ratings;expect(ratings.goodreads.rating).toBe(4.2);expect(ratings.goodreads.status).toBe('stale');expect(ratings.amazon.message).toContain('timeout');db.close();
 });
 it('records disabled providers and deduplicates queued refresh jobs',async()=>{
  const {db,id}=fixture();const client=new BookOrbitClient('secret','http://bookorbit.test');vi.spyOn(client,'ratingProviders').mockResolvedValue([]);const search=vi.spyOn(client,'searchRatings');
  expect(queueRatingRefresh(db,id,true)).toBe(queueRatingRefresh(db,id,true));
  await refreshBatchRatings(db,id,false,client);expect(search).not.toHaveBeenCalled();expect(withStoredRatings(db,book).ratings.amazon.message).toContain('Enable');db.close();
 });
 it('exposes authentication failures and leaves recommendations intact',async()=>{
  const {db,id}=fixture();const client=new BookOrbitClient('secret','http://bookorbit.test');vi.spyOn(client,'ratingProviders').mockRejectedValue(new Error('BookOrbit HTTP 401. Configure BOOKORBIT_TOKEN.'));
  await expect(refreshBatchRatings(db,id,true,client)).rejects.toThrow('401');expect(withStoredRatings(db,book).ratings.goodreads.message).toContain('BOOKORBIT_TOKEN');expect(db.prepare('SELECT status FROM recommendation_batches WHERE id=?').get(id)).toEqual({status:'complete'});db.close();
 });
});
