import type { ShelfDb } from '../db';
import { normalize } from '../identity';
import { hash, representative } from './profile';
import { searchCatalog,enrichBook,resolveAliases } from './catalog';
import type { Profile,Preference } from './types';
/** Enrich a bounded sample of rated history, so sparse/custom shelves aren't the only taste evidence. */
export async function enrichHistory(db:ShelfDb,profile:Profile,onStage:(s:string)=>void){
 const sample=representative(profile);const chosen=[...sample.filter(e=>(e.rating||0)>=4).slice(0,6),...sample.filter(e=>e.rating!==null&&e.rating<=2).slice(0,6)];
 const evidence=profile.evidence.map(e=>({...e}));const signals=new Map<string,{support:string[];counterexamples:string[]}>();let failed=0;
 for(let i=0;i<chosen.length;i++){const e=chosen[i];onStage(`Resolving taste evidence ${i+1}/${chosen.length}`);try{const found=await searchCatalog(db,{kind:'history',query:`title:${JSON.stringify(e.title)} author:${JSON.stringify(e.author)}`,reason:'Verify supporting history metadata'});const exact=found.filter(b=>normalize(b.title)===normalize(e.title)&&normalize(b.author)===normalize(e.author));if(exact.length!==1){failed++;continue;}const b=await enrichBook(db,exact[0]);resolveAliases(db,[b]);const target=evidence.find(x=>x.id===e.id)!;target.catalog={key:b.key,description:b.description,subjects:b.subjects,sourceUrl:`https://openlibrary.org${b.key}`};for(const subject of b.subjects.slice(0,12)){const value=normalize(subject);if(!value||['fiction','literature','general','accessible book','protected daisy','large type books'].includes(value))continue;const signal=signals.get(value)||{support:[],counterexamples:[]};(e.rating!>=4?signal.support:signal.counterexamples).push(e.id);signals.set(value,signal);}}catch{failed++;}}
 const derived:Preference[]=[...signals].slice(0,24).map(([value,s])=>({id:`catalog:${hash(value).slice(0,16)}`,dimension:'subject',value,direction:s.support.length>=s.counterexamples.length?'prefer':'avoid',origin:'inferred',confidence:s.support.length&&s.counterexamples.length?'conflicting':'tentative',support:s.support.length>=s.counterexamples.length?s.support:s.counterexamples,counterexamples:s.support.length>=s.counterexamples.length?s.counterexamples:s.support}));
 const preferences=[...profile.preferences,...derived.filter(p=>!profile.settings.disabled.includes(p.id)&&!profile.preferences.some(x=>normalize(x.value)===p.value))].slice(0,60);
 return {profile:{...profile,sourceVersion:profile.version,evidence,preferences,version:hash({source:profile.version,evidence,preferences})},failed};
}
