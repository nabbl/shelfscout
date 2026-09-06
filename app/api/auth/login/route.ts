import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { createSession, sameOrigin, SESSION_COOKIE } from "@/src/lib/auth";
export async function POST(request:Request){
  if(!await sameOrigin())return NextResponse.json({error:"Cross-origin request rejected"},{status:403});
  const configured=process.env.OWNER_PASSWORD_HASH;if(!configured||(process.env.SESSION_SECRET?.length||0)<32)return NextResponse.json({error:"Owner password and a 32-character session secret must be configured"},{status:503});
  const body=await request.json().catch(()=>({}));const password=typeof body.password==="string"?body.password:"";
  if(!await bcrypt.compare(password,configured))return NextResponse.json({error:"Invalid password"},{status:401});
  const response=NextResponse.json({ok:true});response.cookies.set(SESSION_COOKIE,await createSession(),{httpOnly:true,sameSite:"strict",secure:process.env.NODE_ENV==="production",path:"/",maxAge:60*60*24*30});return response;
}

