import React from 'react';
import {
  MediaDeviceMenu,
  TrackReference,
  TrackToggle,
  useLocalParticipant,
  VideoTrack,
} from '@livekit/components-react';
import { BackgroundProcessor, supportsBackgroundProcessors } from '@livekit/track-processors';
import { isLocalTrack, LocalTrackPublication, Track } from 'livekit-client';
import Desk from '../public/background-images/samantha-gades-BlIhVfXbi9s-unsplash.jpg';
import Nature from '../public/background-images/ali-kazal-tbw_KQE3Cbg-unsplash.jpg';

// Background image paths
const BACKGROUND_IMAGES = [
  { name: 'Desk', path: Desk },
  { name: 'Nature', path: Nature },
];

// Background options
type BackgroundType = 'none' | 'blur' | 'image';

export function CameraSettings() {
  const { cameraTrack, localParticipant } = useLocalParticipant();
  const [backgroundType, setBackgroundType] = React.useState<BackgroundType>(
    (cameraTrack as LocalTrackPublication)?.track?.getProcessor()?.name === 'background-blur'
      ? 'blur'
      : (cameraTrack as LocalTrackPublication)?.track?.getProcessor()?.name === 'virtual-background'
        ? 'image'
        : 'none',
  );

  const [virtualBackgroundImagePath, setVirtualBackgroundImagePath] = React.useState<string | null>(
    null,
  );

  // `@livekit/track-processors` renders backgrounds via a WebGL2 canvas
  // pipeline. On devices/browsers where WebGL2 context creation fails
  // (older iPads, some Android WebViews, GPU-restricted browsers), the
  // library used to fail *silently* mid-pipeline: the camera track kept
  // "publishing" to a canvas that never received a painted frame, which
  // looked exactly like a black, frozen camera -- with no error surfaced
  // to the user or the console. `supportsBackgroundProcessors()` runs the
  // real WebGL2/OffscreenCanvas capability check up front so we can
  // disable these controls entirely, with an explanation, instead of
  // silently breaking the call.
  const [backgroundEffectsSupported] = React.useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try {
      return supportsBackgroundProcessors();
    } catch {
      return false;
    }
  });
  const [processorError, setProcessorError] = React.useState<string | null>(null);

  const camTrackRef: TrackReference | undefined = React.useMemo(() => {
    return cameraTrack
      ? { participant: localParticipant, publication: cameraTrack, source: Track.Source.Camera }
      : undefined;
  }, [localParticipant, cameraTrack]);

  const selectBackground = (type: BackgroundType, imagePath?: string) => {
    if (!backgroundEffectsSupported) return;
    setProcessorError(null);
    setBackgroundType(type);
    if (type === 'image' && imagePath) {
      setVirtualBackgroundImagePath(imagePath);
    } else if (type !== 'image') {
      setVirtualBackgroundImagePath(null);
    }
  };

  React.useEffect(() => {
    if (!backgroundEffectsSupported) return;
    const track = cameraTrack?.track;
    if (!isLocalTrack(track)) return;

    let cancelled = false;

    const apply = async () => {
      try {
        if (backgroundType === 'blur') {
          await track.setProcessor(BackgroundProcessor({ mode: 'background-blur' }));
        } else if (backgroundType === 'image' && virtualBackgroundImagePath) {
          await track.setProcessor(
            BackgroundProcessor({ mode: 'virtual-background', imagePath: virtualBackgroundImagePath }),
          );
        } else {
          await track.stopProcessor();
        }
      } catch (err) {
        // If the processor genuinely fails at runtime (rather than being
        // caught by the upfront capability check), fall back to a plain
        // camera feed instead of leaving the track stuck on a broken
        // processor -- a live, un-blurred camera beats a frozen black one.
        if (cancelled) return;
        console.error('Camv: background processor failed, falling back to plain camera', err);
        setProcessorError(
          'This effect could not be applied on this device/browser. Your camera has been kept on without it.',
        );
        setBackgroundType('none');
        setVirtualBackgroundImagePath(null);
        try {
          await track.stopProcessor();
        } catch {
          // best-effort cleanup
        }
      }
    };

    apply();

    return () => {
      cancelled = true;
    };
  }, [cameraTrack, backgroundType, virtualBackgroundImagePath, backgroundEffectsSupported]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      {camTrackRef && (
        <VideoTrack
          style={{
            maxHeight: '280px',
            objectFit: 'contain',
            objectPosition: 'right',
            transform: 'scaleX(-1)',
          }}
          trackRef={camTrackRef}
        />
      )}

      <section className="lk-button-group">
        <TrackToggle source={Track.Source.Camera}>Camera</TrackToggle>
        <div className="lk-button-group-menu">
          <MediaDeviceMenu kind="videoinput" />
        </div>
      </section>

      <div style={{ marginTop: '10px' }}>
        <div style={{ marginBottom: '8px' }}>Background Effects</div>

        {!backgroundEffectsSupported && (
          <p style={{ fontSize: '13px', opacity: 0.8, marginTop: 0 }}>
            Background blur and virtual backgrounds aren&apos;t supported on this device or
            browser (this needs WebGL2 support). Your camera will stay on without an effect.
          </p>
        )}

        {processorError && (
          <p style={{ fontSize: '13px', color: '#e5484d', marginTop: 0 }}>{processorError}</p>
        )}

        <div
          style={{
            display: 'flex',
            gap: '10px',
            flexWrap: 'wrap',
            opacity: backgroundEffectsSupported ? 1 : 0.4,
            pointerEvents: backgroundEffectsSupported ? 'auto' : 'none',
          }}
        >
          <button
            onClick={() => selectBackground('none')}
            className="lk-button"
            aria-pressed={backgroundType === 'none'}
            disabled={!backgroundEffectsSupported}
            style={{
              border: backgroundType === 'none' ? '2px solid #0090ff' : '1px solid #d1d1d1',
              minWidth: '80px',
            }}
          >
            None
          </button>

          <button
            onClick={() => selectBackground('blur')}
            className="lk-button"
            aria-pressed={backgroundType === 'blur'}
            disabled={!backgroundEffectsSupported}
            style={{
              border: backgroundType === 'blur' ? '2px solid #0090ff' : '1px solid #d1d1d1',
              minWidth: '80px',
              backgroundColor: '#f0f0f0',
              position: 'relative',
              overflow: 'hidden',
              height: '60px',
            }}
          >
            <div
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                backgroundColor: '#e0e0e0',
                filter: 'blur(8px)',
                zIndex: 0,
              }}
            />
            <span
              style={{
                position: 'relative',
                zIndex: 1,
                backgroundColor: 'rgba(0,0,0,0.6)',
                padding: '2px 5px',
                borderRadius: '4px',
                fontSize: '12px',
              }}
            >
              Blur
            </span>
          </button>

          {BACKGROUND_IMAGES.map((image) => (
            <button
              key={image.path.src}
              onClick={() => selectBackground('image', image.path.src)}
              className="lk-button"
              aria-pressed={
                backgroundType === 'image' && virtualBackgroundImagePath === image.path.src
              }
              disabled={!backgroundEffectsSupported}
              style={{
                backgroundImage: `url(${image.path.src})`,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
                width: '80px',
                height: '60px',
                border:
                  backgroundType === 'image' && virtualBackgroundImagePath === image.path.src
                    ? '2px solid #0090ff'
                    : '1px solid #d1d1d1',
              }}
            >
              <span
                style={{
                  backgroundColor: 'rgba(0,0,0,0.6)',
                  padding: '2px 5px',
                  borderRadius: '4px',
                  fontSize: '12px',
                }}
              >
                {image.name}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
