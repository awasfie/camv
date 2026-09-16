// OB-T1 (Bible v11.5/v11.6): Sentry error tracking for the edge runtime.
// This file configures the initialization of Sentry for edge features
// (middleware, edge routes, and so on).
// https://docs.sentry.io/platforms/javascript/guides/nextjs/
import * as Sentry from '@sentry/nextjs';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || 'production',
    sampleRate: parseFloat(process.env.SENTRY_SAMPLE_RATE ?? '1.0') || 1.0,
    tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE ?? '0.1') || 0.1,
    initialScope: {
      tags: { service: 'camv', errorSource: 'edge' },
    },
  });
}
