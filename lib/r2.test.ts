import { describe, expect, it } from 'vitest';
import { objectPath, r2Store, signRequest } from './r2';
import { toCsv } from './consent/http';

const cfg = {
  endpoint: 'https://acct.r2.cloudflarestorage.com',
  accessKeyId: 'AKIDEXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
  region: 'auto',
};

describe('r2 signing', () => {
  it('encodes path segments but keeps slashes', () => {
    expect(objectPath('spenai-recordings', 'a b/2026-10-13T10:00:00.000Z-room.mp4')).toBe(
      '/spenai-recordings/a%20b/2026-10-13T10%3A00%3A00.000Z-room.mp4',
    );
  });
  it('produces a deterministic SigV4 header for a fixed time', () => {
    const when = new Date('2026-10-13T12:00:00Z');
    const a = signRequest(cfg, 'DELETE', 'b', 'k.mp4', when);
    const b = signRequest(cfg, 'DELETE', 'b', 'k.mp4', when);
    expect(a).toEqual(b);
    expect(a.url).toBe('https://acct.r2.cloudflarestorage.com/b/k.mp4');
    expect(a.headers['x-amz-date']).toBe('20261013T120000Z');
    expect(a.headers.Authorization).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/20261013\/auto\/s3\/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/,
    );
    expect(signRequest(cfg, 'HEAD', 'b', 'k.mp4', when).headers.Authorization).not.toBe(
      a.headers.Authorization,
    );
  });
  it('r2Store passes method and status through', async () => {
    const calls: string[] = [];
    const store = r2Store(cfg, (async (url: string, init: RequestInit) => {
      calls.push(`${init.method} ${url}`);
      return { status: init.method === 'HEAD' ? 404 : 204 } as Response;
    }) as unknown as typeof fetch);
    expect(await store.head('b', 'x.mp4')).toBe(404);
    expect(await store.remove('b', 'x.mp4')).toBe(204);
    expect(calls).toEqual([
      'HEAD https://acct.r2.cloudflarestorage.com/b/x.mp4',
      'DELETE https://acct.r2.cloudflarestorage.com/b/x.mp4',
    ]);
  });
});

describe('toCsv', () => {
  it('quotes and neutralises formulas', () => {
    expect(
      toCsv(
        ['a', 'b'],
        [
          ['=1+1', 'x,"y"'],
          [null, new Date('2026-01-01T00:00:00Z')],
        ],
      ),
    ).toBe('a,b\r\n\'=1+1,"x,""y"""\r\n,2026-01-01T00:00:00.000Z\r\n');
  });
});
