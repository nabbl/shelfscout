import { BookOrbitClient } from "@/src/lib/bookorbit";
import { requireOwnerApi } from "@/src/lib/auth";
export async function GET(){const auth=await requireOwnerApi();if(auth)return auth;try{const c=new BookOrbitClient();const [summary,collections]=await Promise.all([c.test(),c.collections()]);return Response.json({ok:true,summary,collections:collections.filter(x=>x.syncToKobo)});}catch(error){return Response.json({ok:false,error:error instanceof Error?error.message:"Connection failed"},{status:502});}}

