// OB-T1 (Bible v11.5/v11.6): Sentry error tracking for the browser client.
// Next.js 15.3+ instrumentation-client convention (replaces sentry.client.config.ts).
// https://docs.sentry.io/platforms/javascript/guides/nextjs/
import * as Sentry from '@sentry/nextjs';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || 'production',
    // Lower client sample rate than server: browser errors are noisier
    // (extensions, ad blockers, flaky mobile networks) and camv is a video
    // app where a single call can generate many transient client warnings.
    sampleRate: parseFloat(process.env.SENTRY_CLIENT_SAMPLE_RATE ?? '0.5') || 0.5,
    tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE ?? '0.1') || 0.1,
    initialScope: {
      tags: { service: 'camv', errorSource: 'client' },
    },
  });
}
