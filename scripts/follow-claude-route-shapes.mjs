/* Privacy-safe route-shape mapper. Uses only a synthetic UUID and public ranked
 * constants. A 401 indicates a registered route reached auth; 404 means no
 * route. No personal identifier, ticket, or response value is printed.
 */
const BRANCH='chatgpt-follow-claude-endpoints';
const UBI='https://public-ubiservices.ubi.com';
const SPACE='c2294cd6-bd01-4f19-81e9-4e5d32cb763a';
const APP='3b27ede8-3ff9-435d-a264-e2de2ccbb2ce';
const BUILD='CERT_PC_70.713_C9831255_D485915_S20473';
const SANDBOX='HERO_PC_LNCH_A';
const SYN='00000000-0000-4000-8000-000000000000';
const T=8000;
const log=s=>console.log(`[FH_ROUTE_SHAPES] ${s}`);
async function sess(){const su=process.env.SUPABASE_URL,sk=process.env.SUPABASE_ANON_KEY,ss=process.env.SESSION_STORE_SECRET;if(su&&sk&&ss)try{const r=await fetch(`${su}/rest/v1/rpc/fh_session_read`,{method:'POST',headers:{apikey:sk,Authorization:`Bearer ${sk}`,'Content-Type':'application/json'},body:JSON.stringify({p_secret:ss}),signal:AbortSignal.timeout(T)});if(r.ok){const b=await r.json();if(b?.ticket)return b}}catch{};return process.env.UBISOFT_TICKET?{ticket:process.env.UBISOFT_TICKET,sessionId:process.env.UBISOFT_SESSION_ID||''}:null}
async function probe(label,url,h){try{const r=await fetch(url,{headers:h,redirect:'manual',signal:AbortSignal.timeout(T)});let resource='-',message='-';try{const b=await r.json();resource=String(b?.resource??'-').replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi,'<uuid>');message=String(b?.message??'-').slice(0,120)}catch{};log(`${label}: status=${r.status} resource=${resource} message=${message}`)}catch(e){log(`${label}: network_error=${e?.name||'Error'}`)}}
async function main(){if(process.env.VERCEL&&process.env.VERCEL_GIT_COMMIT_REF!==BRANCH){log('skipped');return}const s=await sess();log(`session_available=${Boolean(s?.ticket)}`);if(!s?.ticket)return;const h={Accept:'application/json','Ubi-AppId':APP,'X-Platform-AppId':APP,'Ubi-AppBuildId':BUILD,'Ubi-Populations':SANDBOX,'Ubi-SandboxId':SANDBOX,'Ubi-LocaleCode':'en-US','Ubi-SessionId':s.sessionId||'',Authorization:`Ubi_v1 t=${s.ticket}`};
const r1=`${UBI}/v1/spaces/${SPACE}/title/hero/hero-live/heroranking/public/v1/`;
const r2=`${UBI}/v1/spaces/${SPACE}/title/hero/hero-live/heroranking/public/v2/`;
const lb=`${UBI}/v1/spaces/${SPACE}/title/hero/hero-live/heroleaderboard/public/v1/`;
const sk=`${UBI}/v1/spaces/${SPACE}/title/hero/hero-live/skillrating/public/v1/`;
const cases=[
['r1-player-id',r1+`player/${SYN}`],['r1-player-id-rank',r1+`player/${SYN}/rank`],['r1-player-id-ranking',r1+`player/${SYN}/ranking`],['r1-player-id-season',r1+`player/${SYN}/season`],['r1-player-id-skill',r1+`player/${SYN}/skill/1`],['r1-player-rank',r1+'player/rank'],['r1-player-ranked',r1+'player/ranked'],['r1-ranking-player',r1+'ranking/player'],['r1-ranked-player',r1+'ranked/player'],['r1-season-player',r1+'season/player'],
['r2-rank',r2+'rank'],['r2-ranks',r2+'ranks'],['r2-rating',r2+'rating'],['r2-ratings',r2+'ratings'],['r2-player-id',r2+`player/${SYN}`],['r2-players-id',r2+`players/${SYN}`],['r2-ranking-player',r2+'ranking/player'],['r2-ranked-player',r2+'ranked/player'],['r2-season-player',r2+'season/player'],['r2-season0-player',r2+'season0/player'],['r2-rp',r2+'rp'],['r2-progress',r2+'progress'],
['lb-leaderboards',lb+'leaderboards'],['lb-leaderboards-id',lb+'leaderboards/1'],['lb-player-id',lb+`player/${SYN}`],['lb-players-id',lb+`players/${SYN}`],['lb-ranked',lb+'ranked'],['lb-rankings',lb+'rankings'],['lb-list',lb+'list'],
['skill-player-id',sk+`player/${SYN}`],['skill-rating-id',sk+`rating/${SYN}`],['skill-ratings-id',sk+`ratings/${SYN}`],['skill-player-skillfamily',sk+`player/${SYN}/1`],['skill-matchmaking',sk+'matchmaking'],['skill-matchmakingrating',sk+'matchmakingrating'],['skill-trueskill',sk+'trueskill']
];for(const [l,u]of cases)await probe(l,u,h)}
main().catch(e=>log(`unexpected_error=${e?.name||'Error'}`));
