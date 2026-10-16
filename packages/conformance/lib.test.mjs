import { describe, expect, it } from 'vitest';
import {
  roomForDate,
  keysForRoom,
  previousRoom,
  presign,
  signPut,
  parseProbe,
  parseMeanVolume,
  trackChecks,
  verdict,
  streak,
  ledgerRow,
} from './lib.mjs';

const cfg = {
  endpoint: 'https://acct.r2.example.com',
  bucket: 'spenai-recordings',
  accessKey: 'AKID',
  secretKey: 'SECRET',
  region: 'auto',
};
const good = {
  egressStatus: 'EGRESS_COMPLETE',
  error: '',
  stoppedAtMs: 1000,
  endedAtMs: 6000,
  bytesEgress: 500,
  bytesR2: 500,
  bytesDownloaded: 500,
  sha256: 'a'.repeat(64),
  durationSec: 60.4,
  audioStreams: 1,
  meanVolumeDb: -15.2,
};

describe('naming', () => {
  it('room per UTC night and previous night across a month boundary', () => {
    expect(roomForDate(new Date('2026-10-16T23:59:00Z'))).toBe('syn-20261016');
    expect(previousRoom('syn-20261101')).toBe('syn-20261031');
    expect(previousRoom('syn-20260301')).toBe('syn-20260228');
  });
  it('deterministic keys under conformance/cc68/<room>/', () => {
    const k = keysForRoom('syn-20261016', ['pub-a', 'pub-b']);
    expect(k.result).toBe('conformance/cc68/syn-20261016/result.json');
    expect(k.track['pub-b']).toBe('conformance/cc68/syn-20261016/pub-b.ogg');
  });
});

describe('SigV4', () => {
  it('presign is stable for a fixed clock and carries the expiry', () => {
    const when = new Date('2026-10-16T00:00:00Z');
    const a = presign(cfg, 'GET', 'conformance/cc68/syn-20261016/pub-a.ogg', 3600, when);
    expect(a).toBe(presign(cfg, 'GET', 'conformance/cc68/syn-20261016/pub-a.ogg', 3600, when));
    expect(a).toContain('/spenai-recordings/conformance/cc68/syn-20261016/pub-a.ogg?');
    expect(a).toContain('X-Amz-Expires=3600');
    expect(a).toMatch(/X-Amz-Signature=[0-9a-f]{64}$/);
    expect(presign(cfg, 'HEAD', 'x', 3600, when)).not.toBe(presign(cfg, 'GET', 'x', 3600, when));
  });
  it('signPut hashes the body and signs content-type', () => {
    const s = signPut(cfg, 'k.json', '{}', 'application/json', new Date('2026-10-16T00:00:00Z'));
    expect(s.headers['x-amz-content-sha256']).toBe(
      '44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a',
    );
    expect(s.headers.authorization).toContain(
      'SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date',
    );
  });
});

describe('parsing', () => {
  it('ffprobe json', () => {
    const p = parseProbe({
      format: { duration: '60.120000' },
      streams: [{ codec_type: 'audio', codec_name: 'opus', sample_rate: '48000' }],
    });
    expect(p).toEqual({ durationSec: 60.12, audioStreams: 1, codec: 'opus', sampleRate: 48000 });
  });
  it('volumedetect', () => {
    expect(parseMeanVolume('[Parsed_volumedetect_0 @ 0x1] mean_volume: -15.3 dB\n')).toBe(-15.3);
    expect(parseMeanVolume('mean_volume: -inf dB')).toBe(-Infinity);
    expect(parseMeanVolume('nothing')).toBeNull();
  });
});

describe('verdict', () => {
  it('all green track passes', () => {
    const c = trackChecks('pub-a', good);
    expect(c).toHaveLength(7);
    expect(verdict(c).pass).toBe(true);
  });
  it.each([
    ['duration 57.9 s', { durationSec: 57.9 }, 'duration 60 ± 2 s'],
    ['duration 62.1 s', { durationSec: 62.1 }, 'duration 60 ± 2 s'],
    ['silence', { meanVolumeDb: -91 }, 'audio present'],
    ['no audio stream', { audioStreams: 0 }, 'audio present'],
    ['ended 121 s after stop', { endedAtMs: 122000 }, 'egress_ended within 120 s of stop'],
    ['egress failed', { egressStatus: 'EGRESS_FAILED', error: 'upload' }, 'egress complete'],
    ['R2 size mismatch', { bytesR2: 499 }, 'R2 object size == egress size'],
    ['no checksum', { sha256: null }, 'checksum recorded'],
  ])('%s fails exactly its check', (_l, patch, name) => {
    const v = verdict(trackChecks('pub-a', { ...good, ...patch }));
    expect(v.pass).toBe(false);
    expect(v.failed).toContain(`pub-a: ${name}`);
  });
  it('no checks is never a pass', () => expect(verdict([]).pass).toBe(false));
  it('streak counts consecutive prior passes, resets on fail or gap', () => {
    expect(streak(true, [true, true, false, true])).toBe(3);
    expect(streak(true, [null, true])).toBe(1);
    expect(streak(false, [true, true])).toBe(0);
  });
  it('ledger row', () => {
    const row = ledgerRow({
      room: 'syn-20261016',
      startedAt: 't',
      verdict: { pass: true, checks: 14, failures: 0 },
      streak: 1,
      tracks: [{ publisher: 'pub-a', egressId: 'EG_1', durationSec: 60.1, sha256: 'b'.repeat(64) }],
    });
    expect(row).toBe(
      '| CC-68 | syn-20261016 | t | pass | 14 checks, 0 failures | streak 1/30 | pub-a EG_1 60.10 s sha256 `bbbbbbbbbbbb` |',
    );
  });
});
