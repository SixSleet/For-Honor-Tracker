import 'server-only';
import { env } from './env';

/**
 * Pings the operator, once, when the Ubisoft session genuinely needs attention
 * (renewal failed and a re-seed is required). Silence means everything is fine.
 *
 * Sends a payload that both Discord (`content`) and Slack (`text`) accept, so a
 * free webhook from either works with no extra dependency. Never throws — an
 * alerting failure must not take down the request that triggered it.
 */
export async function notifyOperator(message: string): Promise<boolean> {
  if (!env.alertWebhookUrl) return false;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const body = `For Honor Tracker — ${message}`;
    const response = await fetch(env.alertWebhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: body, text: body }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    return response.ok;
  } catch {
    return false;
  }
}
