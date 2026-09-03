/**
 * Removes anything credential-shaped before it can reach a log, a diagnostics
 * response, or the browser. Applied to every upstream body we retain.
 */

// Compared case-insensitively, so entries here are lowercased on use.
const SENSITIVE_KEYS = new Set(
  [
    'ticket',
    'rememberMeTicket',
    'rememberDeviceTicket',
    'sessionId',
    'twoFactorAuthenticationTicket',
    'password',
    'authorization',
    'cookie',
    'set-cookie',
    'key',
    'apikey',
    'api_key',
    'access_token',
    'refresh_token',
    'token',
    'secret',
    'clientSecret',
    // A player's handle on each platform.
    //
    // The report itself now shows two of these — the PSN online id and the
    // Xbox gamertag, which are gaming identities — but this list stays as it
    // is. It is a blunt key filter that cannot tell those apart from the
    // Discord tag and the SteamID64 in the same response, and a retained
    // upstream body is the wrong place to be generous: the page publishes
    // handles deliberately and selectively, a raw body dump would not.
    'nameonplatform',
    'idonplatform',
  ].map((key) => key.toLowerCase()),
);

const PATTERNS: Array<[RegExp, string]> = [
  // Ubisoft ticket header form
  [/Ubi_v1\s+t=[A-Za-z0-9._~+/=-]+/gi, 'Ubi_v1 t=<redacted>'],
  // Basic / Bearer credentials
  [/\b(Basic|Bearer)\s+[A-Za-z0-9._~+/=-]{8,}/gi, '$1 <redacted>'],
  // JWT-shaped values
  [/\beyJ[A-Za-z0-9._-]{20,}/g, '<redacted-jwt>'],
  // Steam Web API keys are 32 uppercase hex characters
  [/\b[A-F0-9]{32}\b/g, '<redacted-key>'],
  // key= / token= / password= in a query string or body
  [/\b(key|token|apikey|api_key|password|secret)=([^&"'\s]+)/gi, '$1=<redacted>'],
  // Anything that looks like an email address
  [/\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g, '<redacted-email>'],
];

/** Redacts a free-form string (response bodies, error messages, URLs). */
export function redactString(input: string): string {
  let out = input;
  for (const [pattern, replacement] of PATTERNS) out = out.replace(pattern, replacement);
  return out;
}

/** Recursively redacts sensitive values in a parsed JSON structure. */
export function redactValue(input: unknown, depth = 0): unknown {
  if (depth > 8) return '<truncated>';
  if (typeof input === 'string') return redactString(input);
  if (Array.isArray(input)) return input.map((item) => redactValue(item, depth + 1));
  if (input && typeof input === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      out[key] = SENSITIVE_KEYS.has(key.toLowerCase())
        ? '<redacted>'
        : redactValue(value, depth + 1);
    }
    return out;
  }
  return input;
}

/**
 * Redacts a body then truncates it. Runs the JSON-aware pass when possible so
 * that a `ticket` field is removed even if its value looks innocuous.
 */
export function redactBody(body: string, maxLength = 1200): string {
  let text = body;
  try {
    text = JSON.stringify(redactValue(JSON.parse(body)));
  } catch {
    text = redactString(body);
  }
  text = redactString(text);
  return text.length > maxLength ? `${text.slice(0, maxLength)}… <truncated>` : text;
}

/** Masks identifiers in a URL so a diagnostics trace does not carry a person. */
export function maskUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    for (const key of [...url.searchParams.keys()]) {
      if (/^(key|token|password|secret)$/i.test(key)) url.searchParams.set(key, '<redacted>');
    }
    return redactString(url.toString());
  } catch {
    return redactString(rawUrl);
  }
}
