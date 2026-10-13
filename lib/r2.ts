/**
 * Minimal SigV4 client for the recordings bucket (R2, S3-compatible, path-style).
 * Only HEAD and DELETE of one named object: the retention job never lists or
 * sweeps the bucket; it deletes exactly the keys camv_recordings holds.
 */
import { createHash, createHmac } from 'crypto';

export type R2Config = {
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
};

export function r2ConfigFromEnv(env: NodeJS.ProcessEnv = process.env): R2Config | null {
  const { RECORDING_S3_ENDPOINT, RECORDING_S3_ACCESS_KEY, RECORDING_S3_SECRET_KEY } = env;
  if (!RECORDING_S3_ENDPOINT || !RECORDING_S3_ACCESS_KEY || !RECORDING_S3_SECRET_KEY) return null;
  return {
    endpoint: RECORDING_S3_ENDPOINT,
    accessKeyId: RECORDING_S3_ACCESS_KEY,
    secretAccessKey: RECORDING_S3_SECRET_KEY,
    region: env.RECORDING_S3_REGION || 'auto',
  };
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const hmac = (k: Buffer | string, s: string) => createHmac('sha256', k).update(s).digest();
const enc = (s: string) =>
  encodeURIComponent(s).replace(
    /[!'()*]/g,
    (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase(),
  );

export function objectPath(bucket: string, key: string): string {
  return `/${enc(bucket)}/${key.split('/').map(enc).join('/')}`;
}

/** Header-signed request (AWS SigV4, empty payload). Exported for tests. */
export function signRequest(
  cfg: R2Config,
  method: 'HEAD' | 'DELETE',
  bucket: string,
  key: string,
  when: Date,
): { url: string; headers: Record<string, string> } {
  const u = new URL(cfg.endpoint);
  const amz = when.toISOString().replace(/[-:]|\.\d{3}/g, '');
  const date = amz.slice(0, 8);
  const path = objectPath(bucket, key);
  const payloadHash = sha256('');
  const canonical = [
    method,
    path,
    '',
    `host:${u.host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amz}\n`,
    'host;x-amz-content-sha256;x-amz-date',
    payloadHash,
  ].join('\n');
  const scope = `${date}/${cfg.region}/s3/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amz, scope, sha256(canonical)].join('\n');
  const kDate = hmac('AWS4' + cfg.secretAccessKey, date);
  const kSigning = hmac(hmac(hmac(kDate, cfg.region), 's3'), 'aws4_request');
  const signature = createHmac('sha256', kSigning).update(toSign).digest('hex');
  return {
    url: `${u.origin}${path}`,
    headers: {
      'x-amz-date': amz,
      'x-amz-content-sha256': payloadHash,
      Authorization: `AWS4-HMAC-SHA256 Credential=${cfg.accessKeyId}/${scope}, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=${signature}`,
    },
  };
}

export type ObjectStore = {
  head(bucket: string, key: string): Promise<number>;
  remove(bucket: string, key: string): Promise<number>;
};

export function r2Store(cfg: R2Config, fetchImpl: typeof fetch = fetch): ObjectStore {
  const call = async (method: 'HEAD' | 'DELETE', bucket: string, key: string) => {
    const { url, headers } = signRequest(cfg, method, bucket, key, new Date());
    const res = await fetchImpl(url, { method, headers });
    return res.status;
  };
  return {
    head: (bucket, key) => call('HEAD', bucket, key),
    remove: (bucket, key) => call('DELETE', bucket, key),
  };
}
