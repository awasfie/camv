'use client';

import * as React from 'react';
import toast from 'react-hot-toast';

/**
 * The LiveKit ControlBar hides the screen-share button whenever
 * `navigator.mediaDevices.getDisplayMedia` is not present on the page's
 * `MediaDevices` object. This is not a stale/UA-sniffed check in the
 * library -- it's a correct capability check.
 *
 * As of this writing, the Screen Capture API (`getDisplayMedia`) is a
 * desktop-only web platform feature: it is not implemented in mobile
 * Safari (iPhone/iPad), mobile Chrome/Firefox/Samsung Internet on
 * Android, or any mobile WebView, regardless of OS version. See MDN's
 * browser-compat-data for MediaDevices.getDisplayMedia -- every "mobile"
 * column reports "No support", including "Safari on iOS".
 *
 * So on iPad/iPhone/Android browsers there genuinely is no button to
 * show: calling `room.localParticipant.setScreenShareEnabled(true)`
 * ourselves would just throw, because the underlying browser API does
 * not exist. Faking a button would be actively misleading.
 *
 * What we *can* fix is discoverability: users (correctly) assume a
 * "missing button" is a bug. This component surfaces a one-time,
 * dismissible toast on mobile browsers that lack the API, explaining
 * why the screen-share control isn't there instead of leaving it silently
 * absent. It renders nothing on any browser that supports screen share
 * (all desktop browsers, including desktop Safari), so desktop is
 * untouched.
 */
export function MobileScreenShareNotice() {
  React.useEffect(() => {
    if (typeof navigator === 'undefined') return;
    const supportsScreenShare = !!navigator.mediaDevices?.getDisplayMedia;
    if (supportsScreenShare) return;

    const alreadyShown = sessionStorage.getItem('camv-mobile-screenshare-notice');
    if (alreadyShown) return;
    sessionStorage.setItem('camv-mobile-screenshare-notice', '1');

    toast(
      'Screen sharing is not supported by this browser on this device. Try joining from a desktop browser to share your screen.',
      {
        duration: 6000,
        icon: '📵',
        position: 'top-center',
        className: 'lk-button',
      },
    );
  }, []);

  return null;
}
