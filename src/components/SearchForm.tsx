'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { USERNAME_PATTERN } from '@/shared/validation';

export function SearchForm({ initialValue = '', size = 'large' }: { initialValue?: string; size?: 'large' | 'compact' }) {
  const router = useRouter();
  const [value, setValue] = useState(initialValue);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) {
      setError('Enter a username to search for.');
      return;
    }
    if (!USERNAME_PATTERN.test(trimmed)) {
      setError('Use letters, numbers, spaces, or . _ - only.');
      return;
    }
    setError(null);
    setPending(true);
    router.push(`/player/${encodeURIComponent(trimmed)}`);
  }

  const tall = size === 'large';

  return (
    <form onSubmit={onSubmit} className="w-full" noValidate>
      <div className="flex flex-col gap-2 sm:flex-row">
        <label htmlFor="username" className="sr-only">
          Ubisoft or Steam username
        </label>
        <input
          id="username"
          name="username"
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            if (error) setError(null);
          }}
          autoComplete="off"
          spellCheck={false}
          maxLength={64}
          placeholder="Enter a username"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'username-error' : undefined}
          className={`field w-full flex-1 px-4 text-ink placeholder:text-ink-faint  ${
            tall ? 'py-4 text-base' : 'py-3 text-sm'
          }`}
        />
        <button
          type="submit"
          disabled={pending}
          className={`btn-accent px-7 text-sm disabled:cursor-wait disabled:opacity-70 ${
            tall ? 'py-4' : 'py-3'
          }`}
        >
          {pending ? 'Searching…' : 'Search'}
        </button>
      </div>
      {error ? (
        <p id="username-error" role="alert" className="mt-2 text-sm text-bad">
          {error}
        </p>
      ) : null}
    </form>
  );
}
