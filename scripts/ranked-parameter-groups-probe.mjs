/* Privacy-safe public configuration extractor.
 * Fetches live For Honor space parameters with the existing server-side ticket,
 * but logs only Ubisoft's public parameter-group names and scalar config values.
 */
const BRANCH='chatgpt-ranked-history-research';
const UBI='https://public-ubiservices.ubi.com';
const SPACE='c2294cd6-bd01-4f19-81e9-4e5d32cb763a';
const APP=process.env.UBISOFT_APP_ID||'f35adcb5-1911-440c-b1c9-48fdc1701c68';
const T=12000;
const log=s=>console.log(`[FH_RANK_GROUPS] ${s}`);

async function sess(){
 const su=process.env.SUPABASE_URL,sk=process.env.SUPABASE_ANON_KEY,ss=process.env.SESSION_STORE_SECRET;
 if(process.env.UBISOFT_TICKET)return{ticket:process.env.UBISOFT_TICKET,sessionId:process.env.UBISOFT_SESSION_ID||''};
 if(su&&sk&&ss)try{const r=await fetch(`${su}/rest/v1/rpc/fh_session_read`,{method:'POST',headers:{apikey:sk,Authorization:`Bearer ${sk}`,'Content-Type':'application/json'},body:JSON.stringify({p_secret:ss}),signal:AbortSignal.timeout(T)});if(r.ok){const b=await r.json();if(b?.ticket)return{ticket:b.ticket,sessionId:b.sessionId||''}}}catch{}
 return null;
}
function summary(v,p='',d=0,out=[]){
 if(d>10||v==null)return out;
 if(Array.isArray(v)){if(v.every(x=>x==null||['string','number','boolean'].includes(typeof x)))out.push(`${p}=[${v.map(String).join(',')}]`);else v.slice(0,50).forEach((x,i)=>summary(x,`${p}[${i}]`,d+1,out));return out}
 if(typeof v!=='object'){out.push(`${p}=${String(v)}`);return out}
 for(const k of Object.keys(v).sort()){const q=p?`${p}.${k}`:k;const x=v[k];if(x==null||['string','number','boolean'].includes(typeof x))out.push(`${q}=${String(x)}`);else summary(x,q,d+1,out);if(out.length>=600)break}return out;
}
function safe(s){return String(s).replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,'<email>').replace(/(Ubi_v1|rm_v1)\s+t=[^\s&"']+/gi,'$1 t=<redacted>').slice(0,900)}
async function main(){
 if(process.env.VERCEL&&process.env.VERCEL_GIT_COMMIT_REF!==BRANCH){log('skipped');return}
 const s=await sess();if(!s?.ticket){log('no_session');return}
 const h={Accept:'application/json','Ubi-AppId':APP,'Ubi-SessionId':s.sessionId||'',Authorization:`Ubi_v1 t=${s.ticket}`};
 const r=await fetch(`${UBI}/v1/spaces/${SPACE}/parameters`,{headers:h,signal:AbortSignal.timeout(T)});log(`status=${r.status}`);if(!r.ok)return;
 const b=await r.json();const params=b?.parameters||{};const names=Object.keys(params).sort();
 log(`parameter_groups=${names.length}`);
 const rankNames=names.filter(n=>/(rank|skill|leader|competitive|league|division)/i.test(n));
 const matchNames=names.filter(n=>/(match|activity)/i.test(n));
 log(`rank_group_names=${rankNames.join('|')||'-'}`);
 log(`match_group_names=${matchNames.join('|')||'-'}`);
 for(const name of rankNames){const lines=summary(params[name],name);log(`rank_group=${name} scalar_count=${lines.length}`);for(const line of lines.slice(0,500))log(`rank: ${safe(line)}`)}
 for(const name of matchNames){const lines=summary(params[name],name);log(`match_group=${name} scalar_count=${lines.length}`);for(const line of lines.slice(0,260))log(`match: ${safe(line)}`)}
}
main().catch(()=>log('unexpected_error'));
