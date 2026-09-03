/* Privacy-safe summary/diff of For Honor current + next public playlist bundles.
 * Prints one row per playlist and only rank-system metadata; never account data.
 */
const BRANCH='chatgpt-ranked-history-research';
const UBI='https://public-ubiservices.ubi.com';
const APP='3b27ede8-3ff9-435d-a264-e2de2ccbb2ce';
const SPACE='c2294cd6-bd01-4f19-81e9-4e5d32cb763a';
const T=12000;
const log=s=>console.log(`[FH_BUNDLE_SUMMARY] ${s}`);
const specialKey=/(rankpoints?|\brp\b|leaderboard|promotion|demotion|placement|tier|rank(?:id|level|division|season|type)?|seasonid)/i;
const specialValue=/\b(bronze|silver|gold|platinum|diamond|master|grandmaster|rank points?|promotion|demotion|placement)\b/i;
function clean(v){return String(v).replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi,'<uuid>').slice(0,500)}
async function sess(){
 if(process.env.UBISOFT_TICKET)return{ticket:process.env.UBISOFT_TICKET,sessionId:process.env.UBISOFT_SESSION_ID||''};
 const su=process.env.SUPABASE_URL,sk=process.env.SUPABASE_ANON_KEY,ss=process.env.SESSION_STORE_SECRET;
 if(su&&sk&&ss)try{const r=await fetch(`${su}/rest/v1/rpc/fh_session_read`,{method:'POST',headers:{apikey:sk,Authorization:`Bearer ${sk}`,'Content-Type':'application/json'},body:JSON.stringify({p_secret:ss}),signal:AbortSignal.timeout(T)});if(r.ok){const b=await r.json();if(b?.ticket)return{ticket:b.ticket,sessionId:b.sessionId||''}}}catch{}
 const uu=process.env.UPSTASH_REDIS_REST_URL,ut=process.env.UPSTASH_REDIS_REST_TOKEN;
 if(uu&&ut)try{const r=await fetch(uu,{method:'POST',headers:{Authorization:`Bearer ${ut}`,'Content-Type':'application/json'},body:JSON.stringify(['GET','ubisoft:session']),signal:AbortSignal.timeout(T)});if(r.ok){const b=await r.json();const x=b?.result?JSON.parse(b.result):null;if(x?.ticket)return{ticket:x.ticket,sessionId:x.sessionId||''}}}catch{}
 return null;
}
async function getJson(url,headers={}){try{const r=await fetch(url,{headers,signal:AbortSignal.timeout(T)});const text=await r.text();let b=null;try{b=JSON.parse(text)}catch{};return{status:r.status,b}}catch{return null}}
function uniq(a){return [...new Set(a)]}
function summary(p){
 const entries=Array.isArray(p?.entries)?p.entries:[];
 const recipeIds=uniq([...(Array.isArray(p?.recipeIds)?p.recipeIds:[]),...entries.map(e=>e?.recipeId).filter(x=>x!==undefined&&x!==null)]);
 return {
   id:p?.id??null,name:p?.name??null,ranked:p?.ranked??null,skillFamily:p?.skillFamily??null,
   divisionSpread:p?.divisionSpread??null,version:p?.version??null,matchType:p?.matchType??null,
   crossplay:p?.crossplay??null,recipeIds,entryCount:entries.length,
   singlePick:p?.playTypeConfigMap?.mmPvp?.singlePick??null,
   minSize:p?.playTypeConfigMap?.mmPvp?.minSizeToStart??null,
   maxGroup:p?.settings?.restrictionSettings?.maximumGroupSize??null,
 };
}
function scanSpecial(v,path='',out=[]){
 if(out.length>=180)return out;
 if(Array.isArray(v)){for(let i=0;i<v.length;i++)scanSpecial(v[i],`${path}[${i}]`,out);return out}
 if(v&&typeof v==='object'){
   for(const [k,x] of Object.entries(v)){
     const p=path?`${path}.${k}`:k;
     if(/^(worldDivision|worldLocation|recipeId|recipeIds)$/i.test(k))continue;
     if((specialKey.test(k)|| (typeof x==='string'&&specialValue.test(x))) && (x==null||typeof x!=='object'))out.push([p,x]);
     scanSpecial(x,p,out); if(out.length>=180)break;
   }
 }
 return out;
}
function stable(x){return JSON.stringify(x)}
async function main(){
 if(process.env.VERCEL&&process.env.VERCEL_GIT_COMMIT_REF!==BRANCH){log('skipped');return}
 const s=await sess();log(`session_available=${Boolean(s?.ticket)}`);if(!s?.ticket)return;
 const h={Accept:'application/json','Ubi-AppId':APP,'X-Platform-AppId':APP,'Ubi-SessionId':s.sessionId||'','Ubi-LocaleCode':'en-US',Authorization:`Ubi_v1 t=${s.ticket}`};
 const p=await getJson(`${UBI}/v1/spaces/${SPACE}/parameters`,h);log(`parameters_status=${p?.status??'ERR'}`);if(!p?.b)return;
 const f=p.b?.parameters?.['fh-configuration']?.fields||{};
 const host=f.hn_playlist_bundles_url||f.playlist_versions_url;
 const names=uniq([f.hn_default_playlist_bundle_name,f.hn_next_playlist_bundle_name].filter(Boolean));
 log(`bundles=${names.map(clean).join(',')||'-'} host_available=${Boolean(host)}`);if(!host)return;
 const datasets=[];
 for(const name of names){
   const base=host.replace(/\/$/,'');
   const urls=[`${base}/fh-playlists-live/${name}`,`${base}/fh-playlists-live/${name}.json`,`${base}/${name}`,`${base}/${name}.json`];
   let data=null;
   for(let i=0;i<urls.length;i++){const x=await getJson(urls[i],{Range:'bytes=0-1000000'});if(x?.b){log(`${clean(name)}: source_candidate=${i+1} status=${x.status}`);data=x.b;break}}
   if(!data){log(`${clean(name)}: no_json`);continue}
   const playlists=Array.isArray(data.playlists)?data.playlists:[];
   const rows=playlists.map(summary);
   log(`${clean(name)}: playlist_count=${rows.length}`);
   for(const r of rows)log(`${clean(name)}: playlist id=${clean(r.id)} name=${clean(r.name)} ranked=${clean(r.ranked)} skillFamily=${clean(r.skillFamily)} divisionSpread=${clean(r.divisionSpread)} version=${clean(r.version)} matchType=${clean(r.matchType)} crossplay=${clean(r.crossplay)} recipes=${r.recipeIds.map(clean).join(',')||'-'} entries=${r.entryCount} singlePick=${clean(r.singlePick)} maxGroup=${clean(r.maxGroup)}`);
   const specials=scanSpecial(data).filter(([path])=>!/(\.ranked$|\.name$|\.skillFamily$)/i.test(path));
   log(`${clean(name)}: special_rank_terms=${specials.length}`);
   for(const [path,val] of specials.slice(0,120))log(`${clean(name)}: special ${clean(path)}=${clean(val)}`);
   datasets.push({name,rows});
 }
 if(datasets.length>=2){
   const [a,b]=datasets;
   const am=new Map(a.rows.map(r=>[String(r.id),r])), bm=new Map(b.rows.map(r=>[String(r.id),r]));
   const ids=uniq([...am.keys(),...bm.keys()]).sort((x,y)=>Number(x)-Number(y));
   let diffs=0;
   for(const id of ids){const x=am.get(id),y=bm.get(id);if(!x||!y){diffs++;log(`diff playlist=${id}: ${!x?'added-in-next':'removed-in-next'}`);continue}if(stable(x)!==stable(y)){diffs++;const fields=Object.keys(x).filter(k=>stable(x[k])!==stable(y[k]));for(const k of fields)log(`diff playlist=${id} name=${clean(y.name||x.name)} field=${k} current=${clean(stable(x[k]))} next=${clean(stable(y[k]))}`)}}
   log(`bundle_diff_count=${diffs}`);
 }
}
main().catch(()=>log('unexpected_error=redacted'));
