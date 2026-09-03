// Pure parsing helpers, importable from tests.

/**
 * Minimal reader for Steam's community XML documents.
 *
 * These are small, fixed-shape documents (`?xml=1` on a profile page), so a
 * dependency-free reader keeps the install lean. It is deliberately not a
 * general XML parser: it understands elements, attributes and CDATA, which is
 * all Steam emits here.
 */

function decodeEntities(input: string): string {
  return input
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, '&')
    .trim();
}

/** Returns the text content of the first `<tag>` in `xml`, or null. */
export function tagText(xml: string, tag: string): string | null {
  const match = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i').exec(xml);
  return match ? decodeEntities(match[1]) : null;
}

/** Returns the raw inner markup of every `<tag>` block, with its attributes. */
export function tagBlocks(xml: string, tag: string): Array<{ attrs: string; inner: string }> {
  const blocks: Array<{ attrs: string; inner: string }> = [];
  const pattern = new RegExp(`<${tag}(\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'gi');
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(xml)) !== null) {
    blocks.push({ attrs: match[1] ?? '', inner: match[2] });
  }
  return blocks;
}

export function attr(attrs: string, name: string): string | null {
  const match = new RegExp(`${name}\\s*=\\s*"([^"]*)"`, 'i').exec(attrs);
  return match ? decodeEntities(match[1]) : null;
}

export function numberOrNull(value: string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(String(value).replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}
