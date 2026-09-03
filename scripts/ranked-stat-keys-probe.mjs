/* Privacy-safe check for ranked/skill keys in existing For Honor stat APIs.
 * Logs only stat key names and Ubisoft-provided generic labels; never values,
 * profile ids, tickets, usernames, or timestamps.
 */
const BRANCH='chatgpt-ranked-history-research';
const UBI='https://public-ubiservices.ubi.com';
const SPACES=['c2294cd6-bd01-4f19-81e9-4e5d32cb763a','882ad5b5-f549-44a1-a434-c465d22fe4bf'];
const APP=process.env.UBISOFT_APP_ID||'f35adcb5-1911-440c-b1c9-48fdc1701c68';
const T=12000;
const log=s=>console.log(`[FH_RANK_STAT_KEYS] ${s}`);
const RX=/(rank|division|skill|rating|elo|mmr|league|tier|placement|competitive|master)/i;

async function sess(){
 if(process.env.UBISOFT_TICKET)return{ticket:process.env.UBISOFT_TICKET,sessionId:process.env.UBISOFT_SESSION_ID||'',profileId:null};
 const su=process.env.SUPABASE_URL,sk=process.env.SUPABASE_ANON_KEY,ss=process.env.SESSION_STORE_SECRET;
 if(su&&sk&&ss)try{const r=await fetch(`${su}/rest/v1/rpc/fh_session_read`,{method:'POST',headers:{apikey:sk,Authorization:`Bearer ${sk}`,'Content-Type':'application/json'},body:JSON.stringify({p_secret:ss}),signal:AbortSignal.timeout(T)});if(r.ok){const b=await r.json();if(b?.ticket)return{ticket:b.ticket,sessionId:b.sessionId||'',profileId:b.profileId||null}}}catch{}
 return null;
}
function safeLabel(s){return String(s).replace(/[\r\n\t]+/g,' ').replace(/\s{2,}/g,' ').replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi,'<uuid>').replace(/\b\d{12,}\b/g,'<id>').slice(0,180)}
function scanStats(body){
 const keys=new Set();
 const profiles=Array.isArray(body?.profiles)?body.profiles:[];
 for(const p of profiles){const stats=p?.stats&&typeof p.stats==='object'?p.stats:{};for(const k of Object.keys(stats))if(RX.test(k))keys.add(k)}
 return [...keys].sort();
}
function scanCard(body){
 const arr=Array.isArray(body?.Statscards)?body.Statscards:Array.isArray(body?.statscards)?body.statscards:[];
 const hits=[];
 for(const x of arr){
   if(!x||typeof x!=='object')continue;
   const fields=[];
   for(const [k,v] of Object.entries(x)){
     if(typeof v==='string'&&RX.test(`${k} ${v}`))fields.push(`${k}=${safeLabel(v)}`);
     else if(RX.test(k))fields.push(`${k}=<value-redacted>`);
   }
   if(fields.length)hits.push(fields.join('|'));
 }
 return [...new Set(hits)].slice(0,80);
}
async function getJson(label,url,h){
 try{const r=await fetch(url,{headers:h,signal:AbortSignal.timeout(T)});log(`${label}: status=${r.status}`);if(!r.ok)return null;return await r.json()}catch(e){log(`${label}: error=${e?.name||'Error'}`);return null}
}
async function main(){
 if(process.env.VERCEL&&process.env.VERCEL_GIT_COMMIT_REF!==BRANCH){log('skipped');return}
 const s=await sess();log(`session_available=${Boolean(s?.ticket)} profile_available=${Boolean(s?.profileId)}`);if(!s?.ticket||!s?.profileId)return;
 const h={Accept:'application/json','Ubi-AppId':APP,'Ubi-SessionId':s.sessionId||'','Ubi-LocaleCode':'en-US',Authorization:`Ubi_v1 t=${s.ticket}`};
 for(let i=0;i<SPACES.length;i++){
   const space=SPACES[i];
   const stats=await getJson(`space-${i+1}-stats`,`${UBI}/v1/profiles/stats?spaceId=${space}&profileIds=${encodeURIComponent(s.profileId)}`,h);
   if(stats){const keys=scanStats(stats);log(`space-${i+1}-stats: matching_key_count=${keys.length}`);log(`space-${i+1}-stats: keys=${keys.join('|')||'-'}`)}
   const card=await getJson(`space-${i+1}-statscard`,`${UBI}/v1/profiles/${encodeURIComponent(s.profileId)}/statscard?spaceId=${space}`,h);
   if(card){const hits=scanCard(card);log(`space-${i+1}-statscard: matching_entry_count=${hits.length}`);for(const x of hits)log(`space-${i+1}-statscard: ${x}`)}
 }
}
main().catch(()=>log('unexpected_error'));
