// Thin wrapper over canvas-drop's `ai` Backend accessor (see
// `../share/canvasdrop.ts`). Pins the model, normalizes error shapes into two
// typed errors the UI can branch on, and never touches `getCanvasdrop()` (and
// therefore `window`/`globalThis.canvasdrop`) until a call is actually made —
// importing this module is SSR-safe, mirroring `renderMarkdown.ts` and
// `canvasdrop.ts`.
import { getCanvasdrop, type AiMessage, type AiChatResult } from '../share/canvasdrop';

export const AI_MODEL = 'claude-sonnet-4-6';

/** Thrown when the AI Backend isn't available: no canvas Backend, no `ai`
 * accessor, or the pinned model isn't allowlisted for this session. */
export class AiUnavailableError extends Error {
  constructor(message = "AI drafting isn't available right now.") {
    super(message);
    this.name = 'AiUnavailableError';
  }
}

/** Thrown when the caller (or the org) has exhausted their AI usage quota. */
export class AiQuotaError extends Error {
  constructor(message = "You've reached today's AI usage limit. Please try again later.") {
    super(message);
    this.name = 'AiQuotaError';
  }
}

/** Thrown when a caller cancels an in-flight `chat`/`stream` call via `signal` (R:
 * client-side cancellation). canvas-drop's `ai.chat`/`ai.stream` don't accept an
 * AbortSignal, so the underlying network call always runs to completion — this error
 * just marks "the caller stopped listening", so callers should swallow it (no error
 * toast) rather than treat it as a real failure. */
export class AiAbortedError extends Error {
  constructor(message = 'Cancelled.') {
    super(message);
    this.name = 'AiAbortedError';
  }
}

export interface ChatOptions {
  system?: string;
  maxTokens?: number;
  /** Client-side-only cancellation: `chat` throws `AiAbortedError` instead of returning
   * a result once aborted; `stream` stops yielding deltas. Never sent to canvas-drop —
   * `ai.chat`/`ai.stream` don't accept an AbortSignal, so the underlying network call
   * itself is never aborted. */
  signal?: AbortSignal;
}

function isQuotaError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { name?: unknown; code?: unknown; status?: unknown };
  return e.name === 'QuotaExceededError' || e.code === 'QUOTA_EXCEEDED' || e.status === 429;
}

function isModelNotAllowed(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: unknown };
  return e.code === 'MODEL_NOT_ALLOWED';
}

/** Maps a raw canvas-drop AI error to a typed, friendly-message error. Any
 * other error is passed through unchanged (still a real `Error`). */
function normalizeError(err: unknown): Error {
  if (isQuotaError(err)) return new AiQuotaError();
  if (isModelNotAllowed(err)) return new AiUnavailableError();
  return err instanceof Error ? err : new Error(String(err));
}

/** Non-streaming chat call. Always pins `model: 'claude-sonnet-4-6'`. If `signal` is
 * already aborted by the time the underlying call resolves, throws `AiAbortedError`
 * instead of returning the (now-unwanted) result — the network call itself still ran
 * to completion; this only discards its result at our wrapper boundary. */
export async function chat(messages: AiMessage[], options: ChatOptions = {}): Promise<AiChatResult> {
  const ai = getCanvasdrop()?.ai;
  if (!ai) throw new AiUnavailableError();
  try {
    const result = await ai.chat(messages, { model: AI_MODEL, system: options.system, maxTokens: options.maxTokens });
    if (options.signal?.aborted) throw new AiAbortedError();
    return result;
  } catch (err) {
    if (err instanceof AiAbortedError) throw err;
    throw normalizeError(err);
  }
}

/** Streaming chat call — yields text deltas in order. Always pins
 * `model: 'claude-sonnet-4-6'`. If `signal` is aborted mid-stream, stops yielding
 * (rather than throwing) and releases the underlying async iterator via `.return?.()`
 * if the runtime supports it — canvas-drop's `ai.stream` has no abort param, so the
 * network stream itself keeps running; this just stops consuming it. */
export async function* stream(messages: AiMessage[], options: ChatOptions = {}): AsyncIterable<string> {
  const ai = getCanvasdrop()?.ai;
  if (!ai) throw new AiUnavailableError();
  const { signal } = options;
  const iterator = ai.stream(messages, { model: AI_MODEL, system: options.system, maxTokens: options.maxTokens })[
    Symbol.asyncIterator
  ]();
  try {
    while (true) {
      if (signal?.aborted) {
        await iterator.return?.();
        break;
      }
      const { value, done } = await iterator.next();
      if (done) break;
      yield value;
    }
  } catch (err) {
    throw normalizeError(err);
  }
}

/** Shared UI-facing error mapping (R10): `AiQuotaError`/`AiUnavailableError` already
 * carry a friendly, user-presentable message (see `normalizeError` above) — surface it
 * verbatim. Anything else (a network hiccup, an unexpected shape) falls back to the
 * caller's own generic message rather than leaking a raw error string. */
export function friendlyAiMessage(err: unknown, fallback: string): string {
  if (err instanceof AiQuotaError || err instanceof AiUnavailableError) return err.message;
  return fallback;
}
