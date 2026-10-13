/**
 * WC-CV-2: per-participant Cloudflare TURN credentials.
 *
 * Minted server-side once per join and handed to the browser in
 * ConnectionDetails.iceServers, which livekit-client uses in place of the
 * LiveKit-advertised ICE servers. When Cloudflare TURN is not configured or the
 * call fails, this returns undefined and the client falls back to LiveKit's
 * embedded TURN on MEDIA-1 (fail soft: a join never fails because of TURN).
 *
 * Secrets by name only: CF_TURN_KEY_ID, CF_TURN_API_TOKEN (Infisical camv:/camv).
 */

export const CF_TURN_TTL_SECONDS = 24 * 60 * 60; // covers the join window (end + 24 h)
const CF_TURN_TIMEOUT_MS = 3000;

export type IceServer = { urls: string[]; username?: string; credential?: string };

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Browsers block port 53; Cloudflare's docs say to drop those URLs for browser clients. */
export function filterBrowserIceServers(servers: unknown): IceServer[] {
  if (!Array.isArray(servers)) return [];
  const out: IceServer[] = [];
  for (const s of servers) {
    if (!s || typeof s !== 'object') continue;
    const raw = (s as { urls?: unknown }).urls;
    const list = (Array.isArray(raw) ? raw : [raw]).filter(
      (u): u is string => typeof u === 'string' && /^(stun|turns?):/.test(u),
    );
    const urls = list.filter((u) => !/:53(\?|$)/.test(u));
    if (urls.length === 0) continue;
    const { username, credential } = s as { username?: unknown; credential?: unknown };
    const entry: IceServer = { urls };
    if (typeof username === 'string') entry.username = username;
    if (typeof credential === 'string') entry.credential = credential;
    out.push(entry);
  }
  return out;
}

export async function mintCloudflareIceServers(opts?: {
  keyId?: string;
  apiToken?: string;
  ttlSeconds?: number;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}): Promise<IceServer[] | undefined> {
  const keyId = opts?.keyId ?? process.env.CF_TURN_KEY_ID;
  const apiToken = opts?.apiToken ?? process.env.CF_TURN_API_TOKEN;
  if (!keyId || !apiToken) return undefined;
  const doFetch: FetchLike = opts?.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts?.timeoutMs ?? CF_TURN_TIMEOUT_MS);
  try {
    const res = await doFetch(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiToken}`,
          'Content-Type': 'application/json',
          'User-Agent': 'camv-turn/1.0',
        },
        body: JSON.stringify({ ttl: opts?.ttlSeconds ?? CF_TURN_TTL_SECONDS }),
        signal: controller.signal,
        cache: 'no-store',
      },
    );
    if (!res.ok) {
      console.warn(
        `[turn] cloudflare generate-ice-servers HTTP ${res.status}; falling back to LiveKit TURN`,
      );
      return undefined;
    }
    const body = (await res.json()) as { iceServers?: unknown };
    const servers = filterBrowserIceServers(body.iceServers);
    const hasRelay = servers.some((s) => s.urls.some((u) => u.startsWith('turn')) && s.credential);
    if (!hasRelay) {
      console.warn('[turn] cloudflare response had no TURN entry; falling back to LiveKit TURN');
      return undefined;
    }
    return servers;
  } catch (e) {
    console.warn(
      `[turn] cloudflare TURN unavailable (${(e as Error).name}); falling back to LiveKit TURN`,
    );
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}
