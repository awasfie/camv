'use client';

import * as React from 'react';
import { useIsRecording, useRoomContext } from '@livekit/components-react';
import { RoomEvent } from 'livekit-client';
import type { ConnectionDetails } from './types';

type Consent = NonNullable<ConnectionDetails['consent']>;
type Locale = 'en' | 'ar';

const FONT = "'Noto Sans', 'Noto Sans Arabic', system-ui, -apple-system, sans-serif";

function initialLocale(): Locale {
  if (typeof navigator === 'undefined') return 'en';
  return navigator.language?.toLowerCase().startsWith('ar') ? 'ar' : 'en';
}

/**
 * WC-CV-3 step 1 — the join banner. Shown to every participant of a room that
 * can be recorded, before they may publish (the token endpoint issued them a
 * token without publish permission). Their answer is POSTed to /api/consent,
 * which persists the consent event and grants publishing when allowed.
 * Also renders the persistent live "REC" indicator (step 2).
 */
export function ConsentGate(props: {
  consent?: Consent;
  participantToken: string;
  wantCamera: boolean;
  wantMicrophone: boolean;
}) {
  const room = useRoomContext();
  const isRecording = useIsRecording();
  const [locale, setLocale] = React.useState<Locale>(initialLocale);
  const [answer, setAnswer] = React.useState<'granted' | 'declined' | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const copy = props.consent?.copy?.[locale];
  const required = !!props.consent?.required;

  // Publish permission can change after the answer (a declined participant gets
  // it back when the recording stops). Turn the chosen devices on whenever the
  // server grants it; the server unpublishes on its own when it revokes it.
  React.useEffect(() => {
    if (!required) return;
    const onPerm = () => {
      if (!answer) return;
      if (room.localParticipant.permissions?.canPublish) {
        if (props.wantCamera) room.localParticipant.setCameraEnabled(true).catch(() => undefined);
        if (props.wantMicrophone)
          room.localParticipant.setMicrophoneEnabled(true).catch(() => undefined);
      }
    };
    room.on(RoomEvent.ParticipantPermissionsChanged, onPerm);
    return () => {
      room.off(RoomEvent.ParticipantPermissionsChanged, onPerm);
    };
  }, [room, required, answer, props.wantCamera, props.wantMicrophone]);

  const submit = async (decision: 'granted' | 'declined') => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/consent', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${props.participantToken}`,
        },
        body: JSON.stringify({ decision, locale }),
      });
      if (!res.ok) {
        setError(
          locale === 'ar'
            ? 'لم نتمكن من حفظ اختيارك. حاول مرة أخرى.'
            : 'We could not save your choice. Try again.',
        );
        return;
      }
      setAnswer(decision);
    } catch {
      setError(locale === 'ar' ? 'تعذّر الاتصال. حاول مرة أخرى.' : 'Connection failed. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const recPill = isRecording ? (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'absolute',
        top: '0.75rem',
        left: '50%',
        transform: 'translateX(-50%)',
        background: '#F06C62',
        color: '#fff',
        borderRadius: '999px',
        padding: '0.25rem 0.75rem',
        fontFamily: FONT,
        fontSize: '0.8rem',
        fontWeight: 700,
        letterSpacing: '0.04em',
        zIndex: 20,
        pointerEvents: 'none',
      }}
    >
      ● {copy?.recordingLive ?? 'REC'}
    </div>
  ) : null;

  if (!required || !copy) return recPill;

  if (answer) {
    return (
      <>
        {recPill}
        {answer === 'declined' && isRecording ? (
          <div
            dir={locale === 'ar' ? 'rtl' : 'ltr'}
            style={{
              position: 'absolute',
              bottom: '5rem',
              left: '50%',
              transform: 'translateX(-50%)',
              background: '#102A5C',
              color: '#fff',
              borderRadius: '0.75rem',
              padding: '0.5rem 1rem',
              fontFamily: FONT,
              fontSize: '0.85rem',
              maxWidth: '28rem',
              zIndex: 20,
            }}
          >
            {copy.declinedNote}
          </div>
        ) : null}
      </>
    );
  }

  return (
    <>
      {recPill}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="camv-consent-title"
        style={{
          position: 'absolute',
          inset: 0,
          background: 'rgba(7, 16, 36, 0.72)',
          display: 'grid',
          placeItems: 'center',
          zIndex: 30,
        }}
      >
        <div
          dir={locale === 'ar' ? 'rtl' : 'ltr'}
          lang={locale}
          style={{
            background: '#102A5C',
            color: '#fff',
            borderRadius: '1rem',
            padding: '1.5rem',
            maxWidth: '30rem',
            width: 'calc(100% - 2rem)',
            fontFamily: FONT,
            display: 'flex',
            flexDirection: 'column',
            gap: '0.75rem',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: '1rem',
            }}
          >
            <h2 id="camv-consent-title" style={{ margin: 0, fontSize: '1.15rem' }}>
              {copy.title}
            </h2>
            <button
              type="button"
              className="lk-button"
              onClick={() => setLocale(locale === 'ar' ? 'en' : 'ar')}
              style={{ fontSize: '0.8rem' }}
            >
              {copy.switchLanguage}
            </button>
          </div>
          <p style={{ margin: 0, lineHeight: 1.5 }}>{copy.body}</p>
          <p style={{ margin: 0, lineHeight: 1.5, opacity: 0.8, fontSize: '0.85rem' }}>
            {copy.basis}
          </p>
          {error ? <p style={{ margin: 0, color: '#F06C62' }}>{error}</p> : null}
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="lk-button"
              disabled={busy}
              onClick={() => submit('granted')}
              style={{ background: '#F06C62', color: '#0B1B3A', fontWeight: 700 }}
            >
              {copy.agree}
            </button>
            <button
              type="button"
              className="lk-button"
              disabled={busy}
              onClick={() => submit('declined')}
            >
              {copy.decline}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
