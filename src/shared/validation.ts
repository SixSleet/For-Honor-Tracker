/** Shared by the browser form and the API route so both agree on what is valid. */
export const USERNAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 ._-]{1,60}$/;

export function validateUsername(
  raw: string | null | undefined,
): { ok: true; value: string } | { ok: false; message: string } {
  const value = (raw ?? '').trim();
  if (!value) return { ok: false, message: 'Enter a username to search for.' };
  if (value.length > 64) return { ok: false, message: 'That username is too long.' };
  if (!USERNAME_PATTERN.test(value)) {
    return {
      ok: false,
      message: 'Usernames may only contain letters, numbers, spaces, and the characters . _ -',
    };
  }
  return { ok: true, value };
}
