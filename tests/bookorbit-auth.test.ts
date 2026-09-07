import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BookOrbitClient } from '../src/lib/bookorbit';
import { bookOrbitAuthenticationMode } from '../src/lib/bookorbit-auth';

let serial = 0;
const base = 'https://bookorbit.test/base';
const jwt = (id: string, seconds = 900) => `${Buffer.from('{"alg":"HS256"}').toString('base64url')}.${Buffer.from(JSON.stringify({sub:1,exp:Math.floor(Date.now()/1000)+seconds,id})).toString('base64url')}.signature`;
const sessionResponse = (token: string, refresh?: string) => Response.json({accessToken:token}, {headers:refresh ? {'Set-Cookie':`refresh_token=${refresh}; Path=/api/v1/auth; HttpOnly; SameSite=Strict`} : {}});
beforeEach(()=>{vi.useFakeTimers({toFake:['Date']});vi.stubEnv('BOOKORBIT_USERNAME',`owner-${++serial}`);vi.stubEnv('BOOKORBIT_PASSWORD','private-password');vi.stubEnv('BOOKORBIT_PASSWORD_FILE','');vi.stubEnv('BOOKORBIT_TOKEN','old-manual-token');});
afterEach(()=>{vi.useRealTimers();vi.unstubAllEnvs();vi.unstubAllGlobals();});

describe('BookOrbit password login and renewable sessions',()=>{
 it('shares one login across concurrent clients and keeps cookies out of API calls',async()=>{
  const token=jwt('first');
  const fetchMock=vi.fn(async(url:URL,init:RequestInit)=>{void init;return url.pathname.endsWith('/auth/login')?sessionResponse(token,'refresh-one'):Response.json([]);});vi.stubGlobal('fetch',fetchMock);
  await Promise.all([new BookOrbitClient(undefined,base).test(),new BookOrbitClient(undefined,base).collections()]);
  const auth=fetchMock.mock.calls.filter(([url])=>url.pathname.endsWith('/auth/login'));expect(auth).toHaveLength(1);expect(JSON.parse(auth[0][1].body as string)).toEqual({username:process.env.BOOKORBIT_USERNAME,password:'private-password'});
  for(const [url,init] of fetchMock.mock.calls){expect(url.origin).toBe('https://bookorbit.test');expect(init.redirect).toBe('error');if(!url.pathname.includes('/auth/')){expect(new Headers(init.headers).get('authorization')).toBe(`Bearer ${token}`);expect(new Headers(init.headers).has('cookie')).toBe(false);}}
 });
 it('renews before access expiry and rotates refresh cookies across new client instances',async()=>{
  let refreshes=0;const cookies:string[]=[];
  const fetchMock=vi.fn(async(url:URL,init:RequestInit)=>{
   if(url.pathname.endsWith('/auth/login'))return sessionResponse(jwt('login'),'refresh-one');
   if(url.pathname.endsWith('/auth/refresh')){cookies.push(new Headers(init.headers).get('cookie')!);return sessionResponse(jwt(`renewed-${++refreshes}`),`refresh-${refreshes+1}`);}
   return Response.json({});
  });vi.stubGlobal('fetch',fetchMock);
  await new BookOrbitClient(undefined,base).test();vi.setSystemTime(Date.now()+880000);
  await Promise.all([new BookOrbitClient(undefined,base).test(),new BookOrbitClient(undefined,base).test()]);vi.setSystemTime(Date.now()+880000);await new BookOrbitClient(undefined,base).test();
  expect(cookies).toEqual(['refresh_token=refresh-one','refresh_token=refresh-2']);expect(fetchMock.mock.calls.filter(([url])=>url.pathname.endsWith('/auth/login'))).toHaveLength(1);
 });
 it('logs in again when the refresh session expires',async()=>{
  let logins=0;
  const fetchMock=vi.fn(async(url:URL)=>url.pathname.endsWith('/auth/login')?sessionResponse(jwt(`login-${++logins}`),'refresh-one'):url.pathname.endsWith('/auth/refresh')?new Response(null,{status:401}):Response.json({}));vi.stubGlobal('fetch',fetchMock);
  await new BookOrbitClient(undefined,base).test();vi.setSystemTime(Date.now()+900000);await new BookOrbitClient(undefined,base).test();expect(logins).toBe(2);
 });
 it('does not reuse a possibly rotated refresh token after a lost response',async()=>{
  let logins=0,refreshes=0;
  vi.stubGlobal('fetch',vi.fn(async(url:URL)=>{if(url.pathname.endsWith('/auth/login'))return sessionResponse(jwt(`login-${++logins}`),'refresh-one');if(url.pathname.endsWith('/auth/refresh')){refreshes++;throw new Error('private network data');}return Response.json({});}));
  const client=new BookOrbitClient(undefined,base);await client.test();vi.setSystemTime(Date.now()+900000);await expect(client.test()).rejects.toThrow('authentication could not connect');vi.setSystemTime(Date.now()+31000);await client.test();expect(logins).toBe(2);expect(refreshes).toBe(1);
 });
 it('retries one confirmed 401 with the same mutation body after renewal',async()=>{
  let posts=0;const bodies:string[]=[];
  vi.stubGlobal('fetch',vi.fn(async(url:URL,init:RequestInit)=>{
   if(url.pathname.endsWith('/auth/login'))return sessionResponse(jwt('one'),'refresh-one');
   if(url.pathname.endsWith('/auth/refresh'))return sessionResponse(jwt('two'),'refresh-two');
   bodies.push(init.body as string);return ++posts===1?new Response(null,{status:401}):Response.json({results:[]});
  }));
  await new BookOrbitClient(undefined,base).finalizeImport(1,2,3);expect(posts).toBe(2);expect(bodies[0]).toBe(bodies[1]);
 });
 it.each([403,500,502])('never replays a mutation after HTTP %s',async status=>{
  let posts=0;vi.stubGlobal('fetch',vi.fn(async(url:URL)=>{if(url.pathname.endsWith('/auth/login'))return sessionResponse(jwt('one'),'refresh-one');posts++;return new Response(null,{status});}));
  await expect(new BookOrbitClient(undefined,base).finalizeImport(1,2,3)).rejects.toThrow(`HTTP ${status}`);expect(posts).toBe(1);
 });
 it('never replays a mutation after a network error',async()=>{
  let posts=0;vi.stubGlobal('fetch',vi.fn(async(url:URL)=>{if(url.pathname.endsWith('/auth/login'))return sessionResponse(jwt('one'),'refresh-one');posts++;throw new TypeError('private request data');}));
  await expect(new BookOrbitClient(undefined,base).finalizeImport(1,2,3)).rejects.toThrow('connection failed');expect(posts).toBe(1);
 });
 it('pauses failed login attempts and never exposes credentials or upstream error bodies',async()=>{
  const fetchMock=vi.fn().mockResolvedValue(new Response('private-password and refresh-secret',{status:401}));vi.stubGlobal('fetch',fetchMock);
  const results=await Promise.allSettled(Array.from({length:12},()=>new BookOrbitClient(undefined,base).test()));expect(fetchMock).toHaveBeenCalledTimes(1);
  for(const result of results){expect(result.status).toBe('rejected');if(result.status==='rejected'){expect(result.reason.message).toContain('HTTP 401');expect(result.reason.message).not.toContain('private-password');}}
  await expect(new BookOrbitClient(undefined,base).test()).rejects.toThrow('temporarily paused');expect(fetchMock).toHaveBeenCalledTimes(1);
  vi.stubEnv('BOOKORBIT_PASSWORD','corrected-password');fetchMock.mockImplementation(async()=>sessionResponse(jwt('fixed')));await new BookOrbitClient(undefined,base).test();expect(fetchMock).toHaveBeenCalledTimes(3);
 });
 it('bounds repeated 401s after a renewed session',async()=>{
  const fetchMock=vi.fn(async(url:URL)=>url.pathname.endsWith('/auth/login')||url.pathname.endsWith('/auth/refresh')?sessionResponse(jwt('one'),'refresh-one'):new Response(null,{status:401}));vi.stubGlobal('fetch',fetchMock);
  const client=new BookOrbitClient(undefined,base);await expect(client.test()).rejects.toThrow('HTTP 401');expect(fetchMock).toHaveBeenCalledTimes(4);await expect(client.test()).rejects.toThrow('rejected the renewed session');expect(fetchMock).toHaveBeenCalledTimes(4);
 });
 it('keeps explicit manual tokens compatible without logging in',async()=>{
  const fetchMock=vi.fn().mockResolvedValue(Response.json({}));vi.stubGlobal('fetch',fetchMock);await new BookOrbitClient('manual',base).test();expect(fetchMock).toHaveBeenCalledTimes(1);expect(new Headers(fetchMock.mock.calls[0][1].headers).get('authorization')).toBe('Bearer manual');
 });
 it('supports password files with literal dollar signs and rejects incomplete configuration',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'bookorbit-password-'));const file=join(dir,'password');writeFileSync(file,'actual$pass\n',{mode:0o600});vi.stubEnv('BOOKORBIT_PASSWORD_FILE',file);
  const fetchMock=vi.fn(async(url:URL,init:RequestInit)=>{void init;return url.pathname.endsWith('/auth/login')?sessionResponse(jwt('file')):Response.json({});});vi.stubGlobal('fetch',fetchMock);
  try{await new BookOrbitClient(undefined,base).test();expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string).password).toBe('actual$pass');}finally{rmSync(dir,{recursive:true,force:true});}
  vi.stubEnv('BOOKORBIT_PASSWORD_FILE','');vi.stubEnv('BOOKORBIT_PASSWORD','');expect(()=>bookOrbitAuthenticationMode()).toThrow('Set both');
 });
 it('rejects malformed or already-expired login tokens without using them',async()=>{
  const fetchMock=vi.fn().mockResolvedValue(sessionResponse(jwt('expired',-1),'refresh-one'));vi.stubGlobal('fetch',fetchMock);await expect(new BookOrbitClient(undefined,base).test()).rejects.toThrow('unexpired access token');expect(fetchMock).toHaveBeenCalledTimes(1);
 });
});
