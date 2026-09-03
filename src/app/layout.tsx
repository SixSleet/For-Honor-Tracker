import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  // Relative URLs in the metadata below resolve against this. Vercel supplies
  // the deployment host; a self-host can override it.
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ??
      (process.env.VERCEL_PROJECT_PRODUCTION_URL
        ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
        : 'http://localhost:3000'),
  ),
  title: {
    default: 'For Honor Tracker',
    template: '%s — For Honor Tracker',
  },
  description:
    'Look up any For Honor player. Every hero, every mode, the whole record — no account, no sign-in.',
  robots: { index: true, follow: true },
  applicationName: 'For Honor Tracker',
  openGraph: {
    type: 'website',
    siteName: 'For Honor Tracker',
    title: 'For Honor Tracker',
    description:
      'Look up any For Honor player. Every hero, every mode, the whole record — no account, no sign-in.',
  },
  twitter: { card: 'summary_large_image' },
};

export const viewport: Viewport = {
  themeColor: '#0a0c10',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col">
        <header className="border-b border-line/80">
          <div className="mx-auto flex w-full max-w-[100rem] items-center justify-between gap-4 px-4 py-3 sm:px-6">
            <Link href="/" className="group flex items-center gap-3">
              <span
                aria-hidden
                className="block h-6 w-1.5 rounded-full bg-accent transition-colors group-hover:bg-accent-bright"
              />
              <span className="text-sm font-semibold tracking-tight text-ink sm:text-base">For Honor Tracker</span>
            </Link>
          </div>
        </header>

        <main className="flex-1">{children}</main>

        <footer className="border-t border-line/80">
          <div className="mx-auto w-full max-w-[100rem] px-4 py-6 text-xs leading-relaxed text-ink-faint sm:px-6">
            <p>
              Unofficial and not affiliated with Ubisoft. For Honor is a trademark of Ubisoft
              Entertainment.
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
