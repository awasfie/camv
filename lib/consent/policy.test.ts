import { describe, expect, it } from 'vitest';
import {
  deleteAfter,
  evaluateConsentGate,
  mayPublishAfterDecision,
  recordingPolicy,
  retentionDaysFor,
  type CamvOrg,
} from './policy';
import { consentCopy, consentCopyBundle, jurisdictionFor, CONSENT_TEXT_VERSION } from './copy';

const org = (o: Partial<CamvOrg> = {}): CamvOrg => ({
  id: 'org_1',
  name: 'Acme',
  country: 'AE',
  plan: 'pro',
  recordingRetentionDays: null,
  recordingEnabled: null,
  ...o,
});

describe('retentionDaysFor (CM.4 / UX.6)', () => {
  it('uses the plan default when no setting', () => {
    expect(retentionDaysFor(org({ plan: 'pro' }))).toBe(30);
    expect(retentionDaysFor(org({ plan: 'business' }))).toBe(365);
    expect(retentionDaysFor(org({ plan: 'embed' }))).toBe(30);
  });
  it('Free has no cloud recording', () => {
    expect(retentionDaysFor(org({ plan: 'free' }))).toBeNull();
  });
  it('honours a setting within the plan ceiling, clamps to default beyond it', () => {
    expect(retentionDaysFor(org({ plan: 'business', recordingRetentionDays: 90 }))).toBe(90);
    expect(retentionDaysFor(org({ plan: 'business', recordingRetentionDays: 30 }))).toBe(30);
    expect(retentionDaysFor(org({ plan: 'pro', recordingRetentionDays: 365 }))).toBe(30);
  });
});

describe('recordingPolicy', () => {
  it('refuses without an org', () => {
    expect(recordingPolicy(null)).toEqual({ allowed: false, reason: 'no_org' });
  });
  it('refuses Egypt orgs under R3-30 (b) even when enabled', () => {
    expect(
      recordingPolicy(org({ country: 'EG', recordingEnabled: true, plan: 'business' })),
    ).toEqual({
      allowed: false,
      reason: 'country_blocked_r3_30',
    });
    expect(recordingPolicy(org({ country: 'eg' })).allowed).toBe(false);
  });
  it('refuses Free plan and org opt-out', () => {
    expect(recordingPolicy(org({ plan: 'free' }))).toMatchObject({
      reason: 'plan_has_no_cloud_recording',
    });
    expect(recordingPolicy(org({ recordingEnabled: false }))).toMatchObject({
      reason: 'disabled_by_org',
    });
  });
  it('allows SA/AE/other with plan retention', () => {
    expect(recordingPolicy(org({ country: 'SA', plan: 'business' }))).toEqual({
      allowed: true,
      retentionDays: 365,
    });
    expect(recordingPolicy(org({ country: null }))).toEqual({ allowed: true, retentionDays: 30 });
  });
});

describe('evaluateConsentGate (CC-70)', () => {
  const a = { identity: 'a', name: 'A' };
  const b = { identity: 'b', name: 'B' };
  it('passes only when every present participant granted', () => {
    expect(
      evaluateConsentGate(
        [a, b],
        [
          { identity: 'a', decision: 'granted' },
          { identity: 'b', decision: 'granted' },
        ],
      ),
    ).toEqual({ ok: true, consented: ['a', 'b'] });
  });
  it('blocks on one pending participant (late joiner)', () => {
    const r = evaluateConsentGate([a, b], [{ identity: 'a', decision: 'granted' }]);
    expect(r).toEqual({ ok: false, pending: [b], declined: [] });
  });
  it('blocks on a decline', () => {
    const r = evaluateConsentGate(
      [a, b],
      [
        { identity: 'a', decision: 'granted' },
        { identity: 'b', decision: 'declined' },
      ],
    );
    expect(r).toEqual({ ok: false, pending: [], declined: [b] });
  });
  it('ignores decisions of people who left', () => {
    expect(
      evaluateConsentGate(
        [a],
        [
          { identity: 'a', decision: 'granted' },
          { identity: 'gone', decision: 'declined' },
        ],
      ),
    ).toEqual({ ok: true, consented: ['a'] });
  });
  it('refuses an empty room', () => {
    expect(evaluateConsentGate([], []).ok).toBe(false);
  });
});

describe('publish rule', () => {
  it('granted always publishes; declined only while nothing is captured', () => {
    expect(mayPublishAfterDecision('granted', true)).toBe(true);
    expect(mayPublishAfterDecision('declined', false)).toBe(true);
    expect(mayPublishAfterDecision('declined', true)).toBe(false);
  });
});

describe('deleteAfter', () => {
  it('adds whole days', () => {
    expect(deleteAfter(new Date('2026-10-13T00:00:00Z'), 30).toISOString()).toBe(
      '2026-11-12T00:00:00.000Z',
    );
  });
});

describe('consent copy (WC-CV-3 step 1)', () => {
  it('maps jurisdictions', () => {
    expect(jurisdictionFor('sa')).toBe('SA');
    expect(jurisdictionFor('AE')).toBe('AE');
    expect(jurisdictionFor('EG')).toBe('EG');
    expect(jurisdictionFor('FR')).toBe('DEFAULT');
    expect(jurisdictionFor(null)).toBe('DEFAULT');
  });
  it('carries a country-specific basis line in both languages', () => {
    expect(consentCopy('SA', 'en').basis).toMatch(/Saudi Personal Data Protection Law/);
    expect(consentCopy('SA', 'ar').basis).toMatch(/نظام حماية البيانات الشخصية/);
    expect(consentCopy('AE', 'en').basis).toMatch(/UAE/);
    expect(consentCopy('EG', 'en').basis).toMatch(/Egypt/);
  });
  it('states purpose: recording, transcript and summary', () => {
    const en = consentCopy('AE', 'en');
    expect(en.body).toMatch(/record/);
    expect(en.body).toMatch(/transcript/);
    expect(en.body).toMatch(/summary/);
  });
  it('UX.2.1: no exclamation marks in any string', () => {
    for (const c of ['SA', 'AE', 'EG', null]) {
      const b = consentCopyBundle(c);
      for (const s of [...Object.values(b.en), ...Object.values(b.ar)]) {
        expect(s).not.toMatch(/[!！]/);
      }
    }
  });
  it('bundles the text version', () => {
    expect(consentCopyBundle('SA').version).toBe(CONSENT_TEXT_VERSION);
  });
});
