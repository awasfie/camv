import { describe, it, expect, vi } from 'vitest';
import { filterBrowserIceServers, mintCloudflareIceServers } from './turnCredentials';

const CF_BODY = {
  iceServers: [
    {
      urls: [
        'stun:stun.cloudflare.com:3478',
        'stun:stun.cloudflare.com:53',
        'turn:turn.cloudflare.com:3478?transport=udp',
        'turn:turn.cloudflare.com:53?transport=udp',
        'turn:turn.cloudflare.com:3478?transport=tcp',
        'turn:turn.cloudflare.com:80?transport=tcp',
        'turns:turn.cloudflare.com:5349?transport=tcp',
        'turns:turn.cloudflare.com:443?transport=tcp',
      ],
      username: 'u',
      credential: 'c',
    },
  ],
};

const ok = (body: unknown, status = 201) =>
  ({ ok: status < 300, status, json: async () => body }) as unknown as Response;

describe('filterBrowserIceServers', () => {
  it('drops port-53 urls and keeps the rest', () => {
    const [s] = filterBrowserIceServers(CF_BODY.iceServers);
    expect(s.urls).not.toContain('stun:stun.cloudflare.com:53');
    expect(s.urls).not.toContain('turn:turn.cloudflare.com:53?transport=udp');
    expect(s.urls).toContain('turns:turn.cloudflare.com:443?transport=tcp');
    expect(s.urls).toHaveLength(6);
    expect(s.username).toBe('u');
    expect(s.credential).toBe('c');
  });

  it('ignores garbage', () => {
    expect(filterBrowserIceServers(null)).toEqual([]);
    expect(filterBrowserIceServers([{ urls: 'http://x' }, 5, null])).toEqual([]);
    expect(filterBrowserIceServers([{ urls: 'stun:a:3478' }])).toEqual([{ urls: ['stun:a:3478'] }]);
  });
});

describe('mintCloudflareIceServers', () => {
  it('returns undefined without calling out when not configured', async () => {
    const f = vi.fn();
    expect(
      await mintCloudflareIceServers({ keyId: '', apiToken: '', fetchImpl: f }),
    ).toBeUndefined();
    expect(f).not.toHaveBeenCalled();
  });

  it('posts the ttl with the bearer token and returns filtered servers', async () => {
    const f = vi.fn(async () => ok(CF_BODY));
    const out = await mintCloudflareIceServers({
      keyId: 'kid',
      apiToken: 'tok',
      ttlSeconds: 600,
      fetchImpl: f,
    });
    expect(out?.[0].urls).toHaveLength(6);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(
      'https://rtc.live.cloudflare.com/v1/turn/keys/kid/credentials/generate-ice-servers',
    );
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
    expect(JSON.parse(init.body as string)).toEqual({ ttl: 600 });
  });

  it('fails soft on HTTP error, network error, and a body without TURN', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(
      await mintCloudflareIceServers({
        keyId: 'k',
        apiToken: 't',
        fetchImpl: async () => ok({}, 401),
      }),
    ).toBeUndefined();
    expect(
      await mintCloudflareIceServers({
        keyId: 'k',
        apiToken: 't',
        fetchImpl: async () => {
          throw new TypeError('fetch failed');
        },
      }),
    ).toBeUndefined();
    expect(
      await mintCloudflareIceServers({
        keyId: 'k',
        apiToken: 't',
        fetchImpl: async () => ok({ iceServers: [{ urls: ['stun:stun.cloudflare.com:3478'] }] }),
      }),
    ).toBeUndefined();
    warn.mockRestore();
  });

  it('times out instead of hanging a join', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const hang = (_u: string, init?: RequestInit) =>
      new Promise<Response>((_res, rej) =>
        init?.signal?.addEventListener('abort', () => rej(new DOMException('x', 'AbortError'))),
      );
    const t0 = Date.now();
    expect(
      await mintCloudflareIceServers({ keyId: 'k', apiToken: 't', fetchImpl: hang, timeoutMs: 50 }),
    ).toBeUndefined();
    expect(Date.now() - t0).toBeLessThan(2000);
    warn.mockRestore();
  });
});
