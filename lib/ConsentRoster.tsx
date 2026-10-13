'use client';

import * as React from 'react';

type RosterEntry = {
  identity: string;
  name: string | null;
  consent: 'granted' | 'declined' | 'pending';
  consentAt: string | null;
  locale: 'en' | 'ar' | null;
  canPublish: boolean;
};

type Roster = {
  gated: boolean;
  recording: boolean;
  allConsented: boolean;
  participants: RosterEntry[];
};

const LABEL: Record<RosterEntry['consent'], string> = {
  granted: 'Agreed',
  declined: 'Declined',
  pending: 'Not answered yet',
};

/** WC-CV-3 step 2: host roster of consent state, refreshed every 5 s while open. */
export function ConsentRoster({ roomName, hostProof }: { roomName: string; hostProof?: string }) {
  const [roster, setRoster] = React.useState<Roster | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let stop = false;
    const load = async () => {
      try {
        const q = new URLSearchParams({ roomName });
        if (hostProof) q.set('hostProof', hostProof);
        const res = await fetch(`/api/consent/roster?${q.toString()}`, { cache: 'no-store' });
        if (stop) return;
        if (!res.ok) {
          setError(res.status === 503 ? null : `Consent list unavailable (HTTP ${res.status}).`);
          setRoster(null);
          return;
        }
        setRoster(await res.json());
        setError(null);
      } catch {
        if (!stop) setError('Consent list unavailable.');
      }
    };
    load();
    const t = setInterval(load, 5000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [roomName, hostProof]);

  if (error) return <p>{error}</p>;
  if (!roster || !roster.gated) return null;

  return (
    <div>
      <h4 style={{ margin: '0.5rem 0' }}>Consent</h4>
      <p style={{ margin: '0 0 0.5rem' }}>
        {roster.allConsented
          ? 'Everyone in the meeting has agreed to recording.'
          : 'Recording can start once everyone in the meeting has agreed.'}
      </p>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {roster.participants.map((p) => (
          <li
            key={p.identity}
            style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem' }}
          >
            <span>{p.name || p.identity}</span>
            <span>
              {LABEL[p.consent]}
              {p.consentAt ? ` · ${new Date(p.consentAt).toLocaleTimeString()}` : ''}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
