// Typed accessor for the canvas-drop browser SDK global (window.canvasdrop),
// mirroring canvas-drop/packages/sdk/src/index.ts. No secrets — identity rides
// the session cookie. Present only when the canvas backend is enabled.

export interface PublishOptions {
  title: string;
  slug?: string;
  tags?: string[];
  access?: AccessRung;
  password?: string;
  expiresAt?: number;
  metadata?: ShareMetadata;
  bundle: Blob | ArrayBuffer;
}

export interface UpdateOptions {
  title?: string;
  tags?: string[];
  access?: AccessRung;
  password?: string | null;
  expiresAt?: number | null;
  metadata?: ShareMetadata;
  bundle?: Blob | ArrayBuffer;
}

export type AccessRung = 'private' | 'specific_people' | 'whole_org' | 'public_link' | 'password';
export type ShareStatus = 'live' | 'expired' | 'revoked' | 'private';
export type ShareMetadata = Record<string, unknown>;

export interface CanvasListFilter {
  sourceApp?: string;
  sourceKind?: string;
  tags?: string[];
}

export interface AuthoredCanvas {
  id: string;
  url: string;
  title: string;
  tags: string[];
  access: AccessRung;
  status: ShareStatus;
  createdAt: number;
  updatedAt: number;
  expiresAt: number | null;
  revokedAt: number | null;
  createdBy: string;
  version: string | null;
  bundleUpdatedAt: number;
  sourceApp: string | null;
  sourceKind: string | null;
  metadata: ShareMetadata;
}
export interface Me { id: string; email: string; name: string }

// AI Backend (canvas-drop's `ai` accessor). Optional — only present when the
// canvas Backend is enabled and the caller has an AI-capable session.
export interface AiMessage { role: 'user' | 'assistant'; content: string }
export interface AiChatOptions { model: string; system?: string; maxTokens?: number }
export interface AiChatResult {
  text: string;
  usage: { inputTokens: number; outputTokens: number };
  cost: number;
}
export interface CanvasdropAi {
  chat(messages: AiMessage[], opts: AiChatOptions): Promise<AiChatResult>;
  stream(messages: AiMessage[], opts: AiChatOptions): AsyncIterable<string>;
}

// Realtime Backend (canvas-drop's `realtime` accessor). Optional — only
// present when the canvas Backend's realtime channels are enabled.
export interface RealtimeUser { id: string; name: string }
export interface RealtimeMessage { event: string; data: unknown; from: RealtimeUser }
export interface RealtimeChannel {
  publish(event: string, data: unknown): void;
  subscribe(cb: (m: RealtimeMessage) => void): void;
  unsubscribe(): void;
  presence(): Promise<RealtimeUser[]>;
  onPresence(cb: (u: RealtimeUser[]) => void): void;
  onJoin(cb: (u: RealtimeUser) => void): void;
  onLeave(cb: (u: RealtimeUser) => void): void;
  close(): void;
}
export interface CanvasdropRealtime {
  channel(name: string): RealtimeChannel;
}

export interface Canvasdrop {
  me(): Promise<Me>;
  canvases: {
    publish(o: PublishOptions): Promise<AuthoredCanvas>;
    update?(id: string, o: UpdateOptions): Promise<AuthoredCanvas>;
    list(filter?: CanvasListFilter): Promise<AuthoredCanvas[]>;
    revoke(id: string): Promise<void>;
  };
  ai?: CanvasdropAi;
  realtime?: CanvasdropRealtime;
}

declare global {
  interface Window { canvasdrop?: Canvasdrop }
}

export function getCanvasdrop(): Canvasdrop | null {
  return (globalThis as { canvasdrop?: Canvasdrop }).canvasdrop ?? null;
}

/** True iff the SDK is loaded and the viewer is a signed-in member. */
export async function canAuthor(): Promise<boolean> {
  const cd = getCanvasdrop();
  if (!cd) return false;
  try {
    await cd.me();
    return true;
  } catch {
    return false;
  }
}

export async function updateAuthoredCanvas(
  cd: Canvasdrop,
  id: string,
  options: UpdateOptions,
): Promise<AuthoredCanvas> {
  if (shouldUseSameOriginAuthoring(globalThis.location)) {
    return updateViaAuthoringEndpoint(id, options, { sameOrigin: true });
  }
  if (typeof cd.canvases.update === 'function') return cd.canvases.update(id, options);
  return updateViaAuthoringEndpoint(id, options, { sameOrigin: false });
}

function shouldUseSameOriginAuthoring(loc: Location): boolean {
  const hostname = loc.hostname.toLowerCase();
  return hostname.endsWith('.canvas-drop.com');
}

function detectCanvasContext(loc: Location, opts: { sameOrigin?: boolean } = {}): { slug: string; apiBase: string } {
  const pathMatch = /^\/c\/([^/]+)/.exec(loc.pathname);
  if (pathMatch) return { slug: pathMatch[1]!, apiBase: loc.origin };

  const labels = loc.hostname.split('.');
  const slug = labels[0]!;
  if (opts.sameOrigin) return { slug, apiBase: loc.origin };
  const baseHost = labels.slice(1).join('.');
  const port = loc.port ? `:${loc.port}` : '';
  return { slug, apiBase: `${loc.protocol}//${baseHost}${port}` };
}

async function updateViaAuthoringEndpoint(
  id: string,
  options: UpdateOptions,
  contextOptions: { sameOrigin?: boolean } = {},
): Promise<AuthoredCanvas> {
  const { bundle, ...metadata } = options;
  const form = new FormData();
  form.set('metadata', JSON.stringify(metadata));
  if (bundle !== undefined) {
    form.set('bundle', bundle instanceof Blob ? bundle : new Blob([bundle], { type: 'application/zip' }), 'bundle.zip');
  }

  const { slug, apiBase } = detectCanvasContext(globalThis.location, contextOptions);
  const res = await fetch(`${apiBase}/v1/c/${slug}/authoring/${encodeURIComponent(id)}`, {
    method: 'PUT',
    credentials: 'include',
    body: form,
  });
  if (!res.ok) throw await canvasdropRequestError(res);
  return (await res.json()) as AuthoredCanvas;
}

async function canvasdropRequestError(res: Response): Promise<Error> {
  const body = await res.json().catch(() => null) as { code?: string; message?: string; hint?: string } | null;
  const err = new Error(body?.hint ?? body?.message ?? body?.code ?? `Canvas Drop request failed (${res.status})`);
  Object.assign(err, { status: res.status, code: body?.code, hint: body?.hint });
  return err;
}
