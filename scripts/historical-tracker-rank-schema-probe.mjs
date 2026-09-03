/* Public historical Tracker schema probe.
 * Uses a sample URL already published in an open-source For Honor stats project.
 * Logs only schema paths/type names containing ranking terminology; no values.
 */
const BRANCH='chatgpt-ranked-history-research';
const URL='https://api.tracker.gg/api/v2/for-honor/standard/profile/xbl/Poor%20yves?1';
const log=s=>console.log(`[FH_TRN_RANK_SCHEMA] ${s}`);
const terms=/(rank|rating|skill|division|tier|leaderboard|mmr|elo|percentile|placement|progress)/i;
function type(v){if(v===null)return'null';if(Array.isArray(v))return`array(${v.length})`;return typeof v}
function walk(v,path='',out=[],depth=0){if(depth>9||out.length>300)return out;if(Array.isArray(v)){if(v[0]!==undefined)walk(v[0],`${path}[]`,out,depth+1);return out}if(v&&typeof v==='object'){for(const [k,x] of Object.entries(v)){const p=path?`${path}.${k}`:k;if(terms.test(k))out.push([p,type(x)]);walk(x,p,out,depth+1);if(out.length>300)break}}return out}
async function main(){if(process.env.VERCEL&&process.env.VERCEL_GIT_COMMIT_REF!==BRANCH){log('skipped');return}try{const r=await fetch(URL,{headers:{Accept:'application/json','User-Agent':'Mozilla/5.0'},redirect:'manual',signal:AbortSignal.timeout(12000)});const text=await r.text();log(`status=${r.status} content_type=${r.headers.get('content-type')||'-'} bytes=${text.length}`);let b=null;try{b=JSON.parse(text)}catch{};if(!b){log('json=false');return}const top=b&&typeof b==='object'?Object.keys(b).sort():[];log(`top_keys=${top.join(',')}`);const paths=walk(b);log(`rank_path_count=${paths.length}`);for(const [p,t] of paths)log(`path=${p} type=${t}`);const segs=b?.data?.segments;if(Array.isArray(segs)){const types=[...new Set(segs.map(x=>x?.type).filter(Boolean))];log(`segment_types=${types.join(',')||'-'}`);const metaKeys=[...new Set(segs.flatMap(x=>x?.metadata&&typeof x.metadata==='object'?Object.keys(x.metadata):[]))].sort();log(`segment_metadata_keys=${metaKeys.join(',')||'-'}`);const statKeys=[...new Set(segs.flatMap(x=>x?.stats&&typeof x.stats==='object'?Object.keys(x.stats):[]).filter(k=>terms.test(k)))].sort();log(`rank_stat_keys=${statKeys.join(',')||'-'}`)}}catch(e){log(`network_error=${e?.name||'Error'}`)}}
main();
