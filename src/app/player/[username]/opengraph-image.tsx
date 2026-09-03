/**
 * The site's card, reused for player pages.
 *
 * A page that sets `openGraph` in its own metadata replaces the parent's
 * object wholesale, which drops the image the root segment's file would
 * otherwise contribute — so player links unfurled with a title and no picture.
 * Re-exporting the root image restores it without generating anything
 * per-player: preview metadata is fetched on every unfurl, and a card carrying
 * a player's figures would mean a lookup per scrape.
 */
// `runtime` is declared here rather than re-exported: Next reads these as
// static fields and cannot follow one through a re-export.
export const runtime = 'nodejs';
export { default, alt, size, contentType } from '../../opengraph-image';
