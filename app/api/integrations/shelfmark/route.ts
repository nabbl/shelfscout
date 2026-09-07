import { ShelfmarkClient } from "@/src/lib/shelfmark";
import { requireOwnerApi } from "@/src/lib/auth";
export async function GET(){const auth=await requireOwnerApi();if(auth)return auth;try{return Response.json({ok:true,activity:await new ShelfmarkClient().test(),role:"release search and completed-file delivery; ShelfScout orchestrates Book Dock import"});}catch(error){return Response.json({ok:false,error:error instanceof Error?error.message:"Connection failed"},{status:502});}}
