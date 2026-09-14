'use client';

import * as React from 'react';
import { useRoomContext, useTracks } from '@livekit/components-react';
import { RemoteTrackPublication, Track, VideoQuality } from 'livekit-client';

type QualityOption = 'auto' | 'high' | 'medium' | 'low';

const QUALITY_LABELS: Record<QualityOption, string> = {
  auto: 'Auto',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

const QUALITY_TO_LIVEKIT: Record<Exclude<QualityOption, 'auto'>, VideoQuality> = {
  high: VideoQuality.HIGH,
  medium: VideoQuality.MEDIUM,
  low: VideoQuality.LOW,
};

/**
 * Lets participants choose how much bandwidth incoming video should use:
 * Auto (LiveKit's adaptiveStream picks quality per-viewport/network
 * automatically -- this is the default and what everyone gets today),
 * or a manual pin to High/Medium/Low for every remote video track, useful
 * on constrained/expensive connections or when a viewer wants to trade
 * clarity for stability.
 *
 * This is a call-wide setting (applies to every current and future remote
 * video track), not per-participant -- matches the simpler ask of an
 * "auto vs selective quality" toggle rather than a full per-tile mixer.
 */
export function QualitySettings() {
  const room = useRoomContext();
  const [quality, setQuality] = React.useState<QualityOption>('auto');

  const remoteVideoTracks = useTracks([Track.Source.Camera, Track.Source.ScreenShare]).filter(
    (t) => !t.participant.isLocal,
  );

  const applyQuality = React.useCallback(
    (next: QualityOption) => {
      setQuality(next);
      remoteVideoTracks.forEach((t) => {
        const pub = t.publication;
        if (!(pub instanceof RemoteTrackPublication)) return;
        if (next === 'auto') {
          // There isn't an explicit "unpin" API -- re-enabling adaptiveStream's
          // own sizing takes effect the moment we stop forcing a ceiling by
          // requesting HIGH (its default) and letting normal viewport-driven
          // adaptiveStream resizing continue from there.
          pub.setVideoQuality(VideoQuality.HIGH);
        } else {
          pub.setVideoQuality(QUALITY_TO_LIVEKIT[next]);
        }
      });
    },
    [remoteVideoTracks],
  );

  // Apply the chosen quality to any track that (re)appears after the
  // initial selection (new participant joins, reconnect, etc.).
  React.useEffect(() => {
    if (quality === 'auto') return;
    remoteVideoTracks.forEach((t) => {
      const pub = t.publication;
      if (pub instanceof RemoteTrackPublication) {
        pub.setVideoQuality(QUALITY_TO_LIVEKIT[quality]);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remoteVideoTracks.length]);

  if (!room) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <p style={{ fontSize: '13px', opacity: 0.8, marginTop: 0 }}>
        Choose how much bandwidth incoming video uses. Auto adapts automatically to your
        connection and screen size; a manual setting keeps that quality even if your connection
        changes.
      </p>
      <div className="lk-button-group">
        {(Object.keys(QUALITY_LABELS) as QualityOption[]).map((opt) => (
          <button
            key={opt}
            className="lk-button"
            aria-pressed={quality === opt}
            onClick={() => applyQuality(opt)}
            style={{
              border: quality === opt ? '2px solid #0090ff' : '1px solid #d1d1d1',
            }}
          >
            {QUALITY_LABELS[opt]}
          </button>
        ))}
      </div>
    </div>
  );
}
