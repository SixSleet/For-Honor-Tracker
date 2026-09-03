/* Public-static-only For Honor ranked playlist extractor.
 * Reads Ubisoft's public playlist bundle JSON and logs ranked playlist objects.
 * No account/session/environment values are read by this script.
 */
const BRANCH = 'chatgpt-ranked-history-research';
const HOST = 'https://playlists-2.forhonor.ubisoft.com';
const BUNDLES = [
  '3802.0.0-prod-tym-week2-v1',
  '3802.0.0-prod-tym-w3-v1',
];
const TIMEOUT = 12000;
const log = (s) => console.log(`[FH_RANKED_PLAYLIST] ${s}`);

function scalarSummary(obj, prefix = '', depth = 0, out = []) {
  if (depth > 6 || obj == null) return out;
  if (Array.isArray(obj)) {
    if (obj.every((x) => ['string','number','boolean'].includes(typeof x))) {
      out.push(`${prefix}=[${obj.map(String).join(',')}]`);
    } else {
      obj.slice(0, 30).forEach((x, i) => scalarSummary(x, `${prefix}[${i}]`, depth + 1, out));
    }
    return out;
  }
  if (typeof obj !== 'object') {
    out.push(`${prefix}=${String(obj)}`);
    return out;
  }
  for (const k of Object.keys(obj).sort()) {
    const p = prefix ? `${prefix}.${k}` : k;
    const v = obj[k];
    if (v == null || ['string','number','boolean'].includes(typeof v)) out.push(`${p}=${String(v)}`);
    else scalarSummary(v, p, depth + 1, out);
    if (out.length >= 260) break;
  }
  return out;
}

function interestingObjects(root) {
  const hits = [];
  function walk(v, path = '', depth = 0) {
    if (depth > 8 || v == null || typeof v !== 'object') return;
    if (Array.isArray(v)) {
      v.forEach((x, i) => walk(x, `${path}[${i}]`, depth + 1));
      return;
    }
    const text = JSON.stringify(v);
    if (/3842653686|1v1 Duel \(Ranked\)|"ranked"\s*:\s*true/i.test(text)) {
      const directSignal = v.ranked === true || v.id === 22 || (Array.isArray(v.recipeIds) && v.recipeIds.includes(3842653686));
      if (directSignal) hits.push({ path, value: v });
    }
    for (const [k, x] of Object.entries(v)) walk(x, path ? `${path}.${k}` : k, depth + 1);
  }
  walk(root);
  return hits;
}

function keyInventory(root) {
  const keys = new Set();
  function walk(v, depth = 0) {
    if (depth > 8 || v == null || typeof v !== 'object') return;
    if (Array.isArray(v)) return v.forEach((x) => walk(x, depth + 1));
    for (const [k, x] of Object.entries(v)) {
      if (/(rank|division|skill|placement|league|tier|master|leader|rating|elo|mmr)/i.test(k)) keys.add(k);
      walk(x, depth + 1);
    }
  }
  walk(root);
  return [...keys].sort();
}

async function load(bundle) {
  const url = `${HOST}/${bundle}.json`;
  const r = await fetch(url, { headers: { Accept: 'application/json,*/*' }, signal: AbortSignal.timeout(TIMEOUT) });
  log(`${bundle}: status=${r.status}`);
  if (!r.ok) return null;
  return r.json();
}

async function main() {
  if (process.env.VERCEL && process.env.VERCEL_GIT_COMMIT_REF !== BRANCH) { log('skipped'); return; }
  for (const bundle of BUNDLES) {
    try {
      const body = await load(bundle);
      if (!body) continue;
      const playlists = Array.isArray(body.playlists) ? body.playlists : [];
      log(`${bundle}: playlist_count=${playlists.length}`);
      const ranked = playlists.filter((p) => p && typeof p === 'object' && p.ranked === true);
      log(`${bundle}: ranked_count=${ranked.length}`);
      log(`${bundle}: ranked_ids=${ranked.map((p) => p.id).join(',') || '-'}`);
      log(`${bundle}: ranked_names=${ranked.map((p) => p.name).join('|') || '-'}`);
      log(`${bundle}: interesting_key_names=${keyInventory(body).join(',') || '-'}`);
      const hits = interestingObjects(body);
      log(`${bundle}: direct_ranked_objects=${hits.length}`);
      for (let i = 0; i < hits.length; i++) {
        log(`${bundle}: object-${i + 1}-path=${hits[i].path || '<root>'}`);
        const lines = scalarSummary(hits[i].value).slice(0, 220);
        for (const line of lines) log(`${bundle}: object-${i + 1}: ${line}`);
      }
    } catch (e) {
      log(`${bundle}: error=${e?.name || 'Error'}`);
    }
  }
}

main().catch(() => log('unexpected_error'));
