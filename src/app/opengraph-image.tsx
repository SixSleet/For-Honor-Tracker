import { ImageResponse } from 'next/og';

/**
 * The card shown when a link to this site is pasted into Discord, Slack or a
 * social post — which is how a tracker actually travels. Rendered here rather
 * than shipped as a file so it stays in step with the site's own palette, and
 * generated without touching any upstream service.
 */
export const runtime = 'nodejs';
export const alt = 'For Honor Tracker';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: '0 90px',
          background: '#0a0c10',
          color: '#e9edf3',
          fontFamily: 'sans-serif',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 22 }}>
          <div style={{ width: 14, height: 60, borderRadius: 7, background: '#ff6a2b' }} />
          <div style={{ fontSize: 68, fontWeight: 700, letterSpacing: -1 }}>For Honor Tracker</div>
        </div>
        <div style={{ marginTop: 26, fontSize: 34, color: '#9aa5b4', maxWidth: 900 }}>
          Every hero, every mode, the whole record. No account, no sign-in — just a name.
        </div>
        <div style={{ display: 'flex', gap: 14, marginTop: 46 }}>
          {[
            ['Knights', '#1a63c6'],
            ['Vikings', '#089868'],
            ['Samurai', '#c72c3a'],
            ['Wu Lin', '#a99400'],
            ['Outlanders', '#cb61c4'],
          ].map(([name, colour]) => (
            <div
              key={name}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '10px 20px',
                borderRadius: 999,
                border: '1px solid #252c37',
                background: '#111419',
                fontSize: 24,
                color: '#9aa5b4',
              }}
            >
              <div style={{ width: 12, height: 12, borderRadius: 3, background: colour }} />
              {name}
            </div>
          ))}
        </div>
      </div>
    ),
    size,
  );
}
