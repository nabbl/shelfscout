import type { Candidate } from "./recommendations";

type RankingContext={positiveTitles:string[];mood:string};

function configuredEndpoint(){
  const base=process.env.MODEL_BASE_URL?.trim();
  if(!base||!process.env.MODEL_NAME||!process.env.MODEL_API_KEY)return null;
  const url=new URL(base);
  if(!["http:","https:"].includes(url.protocol)||url.username||url.password)throw new Error("MODEL_BASE_URL must be an explicit HTTP(S) endpoint without embedded credentials");
  return new URL("chat/completions",url.href.endsWith("/")?url.href:`${url.href}/`);
}

/** Optional OpenAI-compatible ranking adapter. It receives catalog metadata and
 * reading titles only—never review text or secrets—and may only reorder known IDs. */
export async function rerankWithConfiguredModel(candidates:Candidate[],context:RankingContext){
  const endpoint=configuredEndpoint();
  if(!endpoint||candidates.length<2)return {items:candidates,adapter:"deterministic" as const};
  const payload={mood:context.mood.slice(0,80),positiveTitles:context.positiveTitles.slice(0,8),candidates:candidates.map(c=>({workKey:c.workKey,title:c.title,author:c.author,subjects:c.subjects,category:c.category}))};
  const response=await fetch(endpoint,{method:"POST",headers:{"Authorization":`Bearer ${process.env.MODEL_API_KEY}`,"Content-Type":"application/json"},body:JSON.stringify({model:process.env.MODEL_NAME,temperature:0,response_format:{type:"json_object"},messages:[{role:"system",content:"Return JSON {order:string[]} containing only the supplied workKey values, ordered by likely fit. Do not add books or claims."},{role:"user",content:JSON.stringify(payload)}]}),signal:AbortSignal.timeout(15_000)});
  if(!response.ok)throw new Error(`Configured model returned ${response.status}`);
  const body=await response.json() as {choices?:{message?:{content?:string}}[]};
  const parsed=JSON.parse(body.choices?.[0]?.message?.content||"{}") as {order?:unknown};
  if(!Array.isArray(parsed.order))throw new Error("Configured model returned an invalid ranking");
  const byKey=new Map(candidates.map(c=>[c.workKey,c]));
  const order=parsed.order.filter((value):value is string=>typeof value==="string"&&byKey.has(value));
  const unique=[...new Set(order)];
  const items=[...unique.map(key=>byKey.get(key)!),...candidates.filter(c=>!unique.includes(c.workKey))];
  return {items,adapter:"configured-model" as const};
}
