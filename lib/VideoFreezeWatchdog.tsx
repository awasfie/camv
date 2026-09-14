'use client';

import * as React from 'react';
import { useTracks } from '@livekit/components-react';
import { RemoteTrackPublication, Track } from 'livekit-client';

const STALL_THRESHOLD_MS = 6000;
const CHECK_INTERVAL_MS = 2000;

/**
 * Auto-recovers frozen remote video tiles.
 *
 * Ahmed's report: "the video froze at a certain point, and the
 * expand/minimize/maximize video solved the freeze." That's a real,
 * diagnosable symptom, not a vague complaint -- resizing a video tile
 * forces livekit-client's AdaptiveStreamManager to run
 * `updateDimensions()`, which re-evaluates the desired simulcast layer
 * and re-requests it from the SFU. A layer re-request causes the SFU to
 * push a fresh keyframe to the decoder. That "unfreezes" the picture
 * because it forces the video decoder to resync -- which is exactly
 * the kind of recovery a stuck/corrupted decoder pipeline needs after
 * packet loss or a dropped keyframe (both of which we saw directly in
 * LiveKit's own server logs from Ahmed's earlier test: "unbound buffer
 * overflowing, dropping packets", jitter spikes up to 9.5s).
 *
 * Rather than requiring a manual resize every time, this component
 * runs the same underlying recovery automatically: it watches each
 * remote video element for new decoded frames via
 * `requestVideoFrameCallback` (widely supported, including Safari
 * 15.4+; falls back to comparing `readyState`/`currentTime` progress
 * elsewhere). If a video element with an actively-subscribed track
 * stalls for longer than a real freeze would ever legitimately last
 * (STALL_THRESHOLD_MS), we force exactly the same signal a manual
 * resize does: briefly unsubscribe then resubscribe the remote track
 * publication, which makes the SFU send a fresh keyframe and resets
 * the decoder pipeline -- with no user interaction required.
 */
export function VideoFreezeWatchdog() {
  const remoteVideoTracks = useTracks([Track.Source.Camera, Track.Source.ScreenShare]).filter(
    (t) => !t.participant.isLocal,
  );

  React.useEffect(() => {
    if (typeof window === 'undefined') return;

    const cleanups: Array<() => void> = [];

    remoteVideoTracks.forEach((trackRef) => {
      const pub = trackRef.publication;
      if (!(pub instanceof RemoteTrackPublication)) return;
      const mediaTrack = pub.track?.mediaStreamTrack;
      if (!mediaTrack) return;

      // Find the actual <video> element LiveKit attached this track to.
      const videoEl = document.querySelector<HTMLVideoElement>(
        `video[data-lk-local-participant="false"][id*="${pub.trackSid}"], video[data-track-sid="${pub.trackSid}"]`,
      );
      // Fall back: scan all video elements for one whose srcObject contains this track.
      const el =
        videoEl ??
        Array.from(document.querySelectorAll<HTMLVideoElement>('video')).find((v) => {
          const stream = v.srcObject as MediaStream | null;
          return !!stream?.getVideoTracks().some((t) => t.id === mediaTrack.id);
        });
      if (!el) return;

      let lastProgressAt = Date.now();
      let recovering = false;
      let rvfcHandle: number | null = null;

      const markProgress = () => {
        lastProgressAt = Date.now();
      };

      const supportsRVFC = typeof (el as any).requestVideoFrameCallback === 'function';
      const scheduleRVFC = () => {
        rvfcHandle = (el as any).requestVideoFrameCallback(() => {
          markProgress();
          scheduleRVFC();
        });
      };
      if (supportsRVFC) {
        scheduleRVFC();
      }

      const interval = window.setInterval(async () => {
        if (recovering) return;
        // Only treat this as a freeze if the track is actually supposed to be
        // live (subscribed, not muted, tab visible) -- otherwise a
        // legitimately paused/backgrounded video isn't "frozen".
        if (document.hidden) return;
        if (pub.isMuted || !pub.isSubscribed) {
          markProgress();
          return;
        }

        // Without requestVideoFrameCallback support, fall back to watching
        // currentTime progress as a coarser signal.
        if (!supportsRVFC) {
          const nowT = el.currentTime;
          if ((el as any)._camvLastT !== nowT) {
            (el as any)._camvLastT = nowT;
            markProgress();
          }
        }

        const stalledFor = Date.now() - lastProgressAt;
        if (stalledFor < STALL_THRESHOLD_MS) return;

        recovering = true;
        console.warn(
          `Camv: video for track ${pub.trackSid} stalled for ${stalledFor}ms, forcing resubscribe to recover`,
        );
        try {
          pub.setSubscribed(false);
          await new Promise((r) => setTimeout(r, 300));
          pub.setSubscribed(true);
        } catch (err) {
          console.error('Camv: freeze-recovery resubscribe failed', err);
        } finally {
          lastProgressAt = Date.now();
          recovering = false;
        }
      }, CHECK_INTERVAL_MS);

      cleanups.push(() => {
        window.clearInterval(interval);
        if (rvfcHandle !== null && supportsRVFC) {
          (el as any).cancelVideoFrameCallback?.(rvfcHandle);
        }
      });
    });

    return () => cleanups.forEach((fn) => fn());
  }, [remoteVideoTracks]);

  return null;
}
