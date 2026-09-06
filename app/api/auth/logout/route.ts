import { NextResponse } from "next/server";
import { requireCsrf, requireOwnerApi, SESSION_COOKIE } from "@/src/lib/auth";
export async function POST(){const auth=await requireOwnerApi();if(auth)return auth;const csrf=await requireCsrf();if(csrf)return csrf;const r=NextResponse.json({ok:true});r.cookies.set(SESSION_COOKIE,"",{path:"/",maxAge:0});return r;}

