import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CONSENT_TEXT_VERSION, consentCopyBundle } from './copy';

/** docs/legal/camv-consent-texts.md is what counsel reviews; it must match the code. */
describe('consent texts doc matches lib/consent/copy.ts', () => {
  const doc = readFileSync(join(__dirname, '../../docs/legal/camv-consent-texts.md'), 'utf8');
  it('names the current text version', () => {
    expect(doc).toContain(`CONSENT_TEXT_VERSION = ${CONSENT_TEXT_VERSION}`);
  });
  for (const c of ['SA', 'AE', 'EG', null]) {
    it(`contains every ${c ?? 'DEFAULT'} string`, () => {
      const b = consentCopyBundle(c);
      for (const loc of ['en', 'ar'] as const) {
        const t = b[loc];
        for (const s of [t.title, t.body, t.basis, t.agree, t.decline, t.declinedNote]) {
          expect(doc).toContain(s);
        }
      }
    });
  }
});
