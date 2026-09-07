import { SignJWT, jwtVerify } from "jose";
import { cookies, headers } from "next/headers";
import { randomBytes, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE="shelfscout_session";
export const CSRF_COOKIE="shelfscout_csrf";
const secret=()=>{const value=process.env.SESSION_SECRET;if(!value||value.length<32)throw new Error("SESSION_SECRET must contain at least 32 characters");return new TextEncoder().encode(value);};

export async function createSession() { return new SignJWT({role:"owner"}).setProtectedHeader({alg:"HS256"}).setIssuedAt().setExpirationTime("30d").sign(secret()); }
export async function validSession(token?:string) { if(!token)return false; try{const {payload}=await jwtVerify(token,secret());return payload.role==="owner";}catch{return false;} }
export async function isOwner() { const jar=await cookies(); return validSession(jar.get(SESSION_COOKIE)?.value); }
export function newCsrf(){return randomBytes(24).toString("base64url");}
export async function requireOwnerApi() { if(await isOwner())return null; return Response.json({error:"Authentication required"},{status:401}); }
export async function requireCsrf() { const h=await headers(); const jar=await cookies(); const supplied=h.get("x-csrf-token")||""; const expected=jar.get(CSRF_COOKIE)?.value||""; if(!supplied||!expected)return Response.json({error:"Invalid CSRF token"},{status:403}); const a=Buffer.from(supplied),b=Buffer.from(expected);if(a.length!==b.length||!timingSafeEqual(a,b))return Response.json({error:"Invalid CSRF token"},{status:403}); return null; }
export async function sameOrigin() { const h=await headers(); const origin=h.get("origin");if(!origin)return true;const host=h.get("host");try{return new URL(origin).host===host;}catch{return false;} }
