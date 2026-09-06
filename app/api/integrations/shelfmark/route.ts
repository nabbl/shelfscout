import { ShelfmarkClient } from "@/src/lib/shelfmark";
import { requireOwnerApi } from "@/src/lib/auth";
export async function GET(){const auth=await requireOwnerApi();if(auth)return auth;try{return Response.json({ok:true,health:await new ShelfmarkClient().health(),role:"optional connection only; acquisitions remain owned by BookOrbit"});}catch(error){return Response.json({ok:false,error:error instanceof Error?error.message:"Connection failed"},{status:502});}}
