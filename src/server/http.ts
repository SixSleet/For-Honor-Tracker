import 'server-only';
import type { DiagnosticTrace } from '@/shared/types';
import { maskUrl, redactBody } from './redact';

const USER_AGENT =
  'ForHonorTracker/0.1 (+https://github.com/SixSleet/For-Honor-Tracker) open-source stats viewer';

export interface TracedResponse {
  status: number;
  ok: boolean;
  text: string;
  headers: Headers;
}

export interface TraceCollector {
  traces: DiagnosticTrace[];
}

export function newTraceCollector(): TraceCollector {
  return { traces: [] };
}

export interface TracedRequest {
  provider: string;
  label: string;
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
}

/**
 * Performs an upstream request and records a redacted trace of it. Never
 * throws on an HTTP error status — callers decide what a status means. Throws
 * only on a transport failure, and records that too.
 */
export async function tracedFetch(
  request: TracedRequest,
  collector: TraceCollector,
): Promise<TracedResponse> {
  const { provider, label, url, method = 'GET', headers = {}, body, timeoutMs = 10_000 } = request;
  const startedAt = Date.now();
  const requestHeaders = { 'User-Agent': USER_AGENT, ...headers };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method,
      headers: requestHeaders,
      body,
      signal: controller.signal,
      cache: 'no-store',
      // Manual, so an upstream bouncing us to a login page surfaces as a 302
      // to reason about rather than a 200 of HTML we would misread as data.
      redirect: 'manual',
    });
    const text = await response.text();
    collector.traces.push({
      provider,
      label,
      method,
      url: maskUrl(url),
      requestHeaderNames: Object.keys(requestHeaders),
      status: response.status,
      ok: response.ok,
      durationMs: Date.now() - startedAt,
      responseSnippet: redactBody(text),
    });
    return { status: response.status, ok: response.ok, text, headers: response.headers };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    collector.traces.push({
      provider,
      label,
      method,
      url: maskUrl(url),
      requestHeaderNames: Object.keys(requestHeaders),
      status: null,
      ok: false,
      durationMs: Date.now() - startedAt,
      responseSnippet: '',
      error: redactBody(message, 300),
    });
    throw new UpstreamError(`${provider}: ${label} failed`, { cause: error });
  } finally {
    clearTimeout(timer);
  }
}

export class UpstreamError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'UpstreamError';
  }
}

export function parseJson<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}
