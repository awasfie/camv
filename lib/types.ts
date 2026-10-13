import { LocalAudioTrack, LocalVideoTrack, videoCodecs } from 'livekit-client';
import { VideoCodec } from 'livekit-client';
import type { consentCopyBundle } from './consent/copy';

export interface SessionProps {
  roomName: string;
  identity: string;
  audioTrack?: LocalAudioTrack;
  videoTrack?: LocalVideoTrack;
  region?: string;
  turnServer?: RTCIceServer;
  forceRelay?: boolean;
}

export interface TokenResult {
  identity: string;
  accessToken: string;
}

export function isVideoCodec(codec: string): codec is VideoCodec {
  return videoCodecs.includes(codec as VideoCodec);
}

export type ConnectionDetails = {
  serverUrl: string;
  roomName: string;
  participantName: string;
  participantToken: string;
  /** True if this participant matched the booking's host per Timeway. */
  isHost?: boolean;
  /** Short-lived HMAC proof, present only when isHost is true, required
   * by /api/record/start and /api/record/stop to authorize the request. */
  hostProof?: string;
  /** WC-CV-2: per-participant Cloudflare TURN credentials. Absent => the
   * client uses LiveKit's embedded TURN on MEDIA-1. */
  iceServers?: { urls: string[]; username?: string; credential?: string }[];
  /** WC-CV-3: consent gate state for this room. `required` => the token has no
   * publish permission until the participant answers the banner. */
  consent?: {
    required: boolean;
    recordingAvailable: boolean;
    reason?: string;
    country: string | null;
    copy?: ReturnType<typeof consentCopyBundle>;
  };
};
