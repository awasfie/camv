/**
 * WC-CV-3: the LiveKit side of the consent gate — who is present, whether a
 * capture (egress) is running, and the publish permission of one participant.
 */
import { EgressClient, RoomServiceClient, TokenVerifier } from 'livekit-server-sdk';
import type { PresentParticipant } from './policy';

/** ParticipantInfo_Kind.STANDARD — humans in browsers (egress/agents excluded). */
const KIND_STANDARD = 0;

function httpsHost(): string {
  const url = process.env.LIVEKIT_URL;
  if (!url) throw new Error('LIVEKIT_URL is not defined');
  const u = new URL(url);
  u.protocol = 'https:';
  return u.origin;
}

export type LiveKitOps = {
  presentParticipants(
    room: string,
  ): Promise<(PresentParticipant & { sid: string; canPublish: boolean })[]>;
  getParticipant(
    room: string,
    identity: string,
  ): Promise<{ sid: string; name: string; canPublish: boolean } | null>;
  captureActive(room: string): Promise<boolean>;
  setCanPublish(room: string, identity: string, canPublish: boolean): Promise<void>;
  verifyParticipantToken(
    token: string,
  ): Promise<{ identity: string; room: string; name: string | null } | null>;
};

export function liveKitOps(): LiveKitOps {
  const key = process.env.LIVEKIT_API_KEY;
  const secret = process.env.LIVEKIT_API_SECRET;
  const rooms = () => new RoomServiceClient(httpsHost(), key, secret);
  const egress = () => new EgressClient(httpsHost(), key, secret);

  return {
    async presentParticipants(room) {
      const list = await rooms().listParticipants(room);
      return list
        .filter((p) => Number(p.kind ?? KIND_STANDARD) === KIND_STANDARD)
        .map((p) => ({
          identity: p.identity,
          name: p.name || null,
          sid: p.sid,
          canPublish: p.permission?.canPublish !== false,
        }));
    },
    async getParticipant(room, identity) {
      try {
        const p = await rooms().getParticipant(room, identity);
        return { sid: p.sid, name: p.name, canPublish: p.permission?.canPublish !== false };
      } catch {
        return null;
      }
    },
    async captureActive(room) {
      const list = await egress().listEgress({ roomName: room, active: true });
      // EgressStatus: 0 STARTING, 1 ACTIVE, 2 ENDING — all still capturing.
      return list.some((e) => e.status < 3);
    },
    async setCanPublish(room, identity, canPublish) {
      await rooms().updateParticipant(room, identity, {
        permission: { canPublish, canSubscribe: true, canPublishData: true },
      });
    },
    async verifyParticipantToken(token) {
      if (!key || !secret) return null;
      try {
        const claims = await new TokenVerifier(key, secret).verify(token);
        const room = claims.video?.room;
        if (!claims.sub || !room || !claims.video?.roomJoin) return null;
        return { identity: claims.sub, room, name: claims.name ?? null };
      } catch {
        return null;
      }
    },
  };
}
