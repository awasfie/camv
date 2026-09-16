// OB-T1: Next.js Instrumentation hook — this is what actually REGISTERS
// sentry.server.config.ts / sentry.edge.config.ts. Without this file,
// those configs are never imported/executed, so Sentry.init() never runs
// even though the config files exist (learned this the hard way: initial
// deploy had zero Sentry init calls firing despite all three config files
// being present, because nothing was importing sentry.server.config.ts).
import * as Sentry from '@sentry/nextjs';

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  }

  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
}

// Automatically captures unhandled server-side errors (Server Components,
// middleware, route handlers) without needing a try/catch everywhere.
export const onRequestError = Sentry.captureRequestError;
