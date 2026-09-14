'use client';

import * as React from 'react';
import toast from 'react-hot-toast';

/**
 * The LiveKit ControlBar hides the screen-share button whenever
 * `navigator.mediaDevices.getDisplayMedia` is not present on the page's
 * `MediaDevices` object. This is not a stale/UA-sniffed check in the
 * library -- it's a correct capability check.
 *
 * Verified against caniuse.com's live compatibility table (checked
 * 2026-09-15, includes Safari 26.6/27, the newest releases as of this
 * writing): iOS Safari has ZERO support for getDisplayMedia() on any
 * version to date, including the newest ones -- this is not a gap that
 * a newer iPadOS closes, it is a platform limitation of WebKit on iOS.
 * Every other mobile browser (Chrome/Firefox/Samsung Internet on
 * Android, any mobile WebView) reports the same "not supported".
 *
 * This is also why Zoom/Google Meet/Teams's iPad screen share "just
 * works" despite this: those are NATIVE App Store apps, not websites.
 * They use iOS's ReplayKit Broadcast Upload Extension, a native-app-only
 * API with no web equivalent. A web app running inside Safari (which is
 * what Camv is) cannot reach that API -- no client-side code change can
 * add it; it would require shipping and maintaining a separate native
 * iOS app with a Broadcast Upload Extension target, a materially
 * different and much larger project than a web fix.
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
