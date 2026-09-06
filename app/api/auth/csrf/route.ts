import { NextResponse } from "next/server";
import { CSRF_COOKIE, newCsrf } from "@/src/lib/auth";
export async function GET(){const token=newCsrf();const response=NextResponse.json({token});response.cookies.set(CSRF_COOKIE,token,{httpOnly:false,sameSite:"strict",secure:process.env.NODE_ENV==="production",path:"/"});return response;}

