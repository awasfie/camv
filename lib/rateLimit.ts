import Redis from 'ioredis';

/**
 * Redis-backed token-bucket rate limiter (RA-T3, Bible v11.5).
 *
 * Reuses the same Redis instance already deployed for salesos-api on
 * NEW_SERVER's shared `coolify` Docker network -- both apps run on the
 * same host/network, so no new infrastructure is needed for this.
 *
 * Fails OPEN (allows the request) if Redis is unreachable or unconfigured,
 * rather than blocking all joins/recordings during a Redis outage --
 * matches the Bible's fail-soft philosophy (ID.4): a rate-limiter outage
 * should degrade to "unprotected but working", not "nobody can join".
 */

const REDIS_URL = process.env.RATE_LIMIT_REDIS_URL;

let client: Redis | null | undefined;

function getClient(): Redis | null {
  if (client !== undefined) return client;
  if (!REDIS_URL) {
    client = null;
    return client;
  }
  client = new Redis(REDIS_URL, {
    maxRetriesPerRequest: 1,
    connectTimeout: 1500,
    lazyConnect: true,
    retryStrategy: () => null, // never auto-reconnect-retry-loop; just fail open per-call
  });
  client.on('error', () => {
    // Swallow -- checkRateLimit already fails open below. Avoid unhandled
    // 'error' event crashing the process (ioredis requires a listener).
  });
  return client;
}

export type RateLimitResult = { allowed: boolean; remaining: number; limit: number };

/**
 * Sliding-window-ish fixed-window counter: `key` gets at most `limit` hits
 * per `windowSeconds`. Good enough for abuse protection on these endpoints
 * without needing a more complex sliding-window/token-bucket structure.
 */
export async function checkRateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const redis = getClient();
  if (!redis) {
    return { allowed: true, remaining: limit, limit };
  }
  try {
    const bucketKey = `ratelimit:${key}`;
    const count = await redis.incr(bucketKey);
    if (count === 1) {
      await redis.expire(bucketKey, windowSeconds);
    }
    return { allowed: count <= limit, remaining: Math.max(0, limit - count), limit };
  } catch {
    // Redis unreachable/timed out -- fail open, don't block real users.
    return { allowed: true, remaining: limit, limit };
  }
}

function clientIp(headers: Headers): string {
  // Coolify/Traefik/Cloudflare set these; fall back to a constant bucket
  // (better than crashing) if none are present, e.g. local dev.
  return (
    headers.get('cf-connecting-ip') ||
    headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    headers.get('x-real-ip') ||
    'unknown'
  );
}

export function rateLimitHeaders(result: RateLimitResult): Record<string, string> {
  return {
    'X-RateLimit-Limit': String(result.limit),
    'X-RateLimit-Remaining': String(result.remaining),
  };
}

export { clientIp };
