'use client';

import * as React from 'react';

type HostContextValue = {
  isHost: boolean;
  hostProof?: string;
};

const HostContext = React.createContext<HostContextValue>({ isHost: false });

export function HostProvider({
  isHost,
  hostProof,
  children,
}: HostContextValue & { children: React.ReactNode }) {
  const value = React.useMemo(() => ({ isHost, hostProof }), [isHost, hostProof]);
  return <HostContext.Provider value={value}>{children}</HostContext.Provider>;
}

/**
 * Whether the current participant is this meeting's host (per Timeway's
 * booking record), and the signed proof needed to authorize recording
 * start/stop requests as that host. Camv has no login system of its own,
 * so this is a name-match against the booking host, established once at
 * join time by /api/booking-connection-details and carried through
 * context rather than re-derived in the UI.
 */
export function useHost() {
  return React.useContext(HostContext);
}
