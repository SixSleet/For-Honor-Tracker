import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

// Public playlist bundles only; no network access, credentials or player data.
const [oldPath, newPath] = process.argv.slice(2);
if (!oldPath || !newPath || process.argv.length !== 4) {
  console.error('Usage: node scripts/compare-ranked-playlists.mjs OLD.json NEW.json');
  process.exitCode = 1;
} else {
  const snapshots = [];
  for (const path of [oldPath, newPath]) {
    const raw = await readFile(path);
    const data = JSON.parse(raw);
    const ranked = data.playlists.filter(p => p.ranked === true).map(p => ({
      id: p.id, name: p.name, skillFamily: p.skillFamily, recipeIds: p.recipeIds,
      divisionSpread: p.divisionSpread,
      minimumReputation: p.totalHeroProgressionRestriction,
      maximumGroupSize: p.settings?.restrictionSettings?.maximumGroupSize,
      singlePick: p.playTypeConfigMap?.mmPvp?.singlePick,
    }));
    snapshots.push({ sha256: createHash('sha256').update(raw).digest('hex'), saveDate: data.saveDate, ranked });
  }
  const [before, after] = snapshots;
  console.log(JSON.stringify({ before, after,
    added: after.ranked.filter(p => !before.ranked.some(old => old.id === p.id)),
    removedIds: before.ranked.filter(p => !after.ranked.some(current => current.id === p.id)).map(p => p.id),
    note: 'Playlist and skill-family IDs are game configuration, not proven ranked API parameters. A retained playlist does not prove it remains available in the UI.',
  }, null, 2));
}
