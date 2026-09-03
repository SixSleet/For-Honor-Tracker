'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

export function RefreshButton({ username }: { username: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState(false);

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        setDone(false);
        startTransition(() => {
          router.replace(`/player/${encodeURIComponent(username)}?refresh=1`);
          router.refresh();
          setDone(true);
        });
      }}
      className="btn-quiet shrink-0 self-start px-4 py-2 text-xs disabled:opacity-60 sm:self-auto"
    >
      {pending ? 'Refreshing…' : done ? 'Refreshed' : 'Refresh'}
    </button>
  );
}
