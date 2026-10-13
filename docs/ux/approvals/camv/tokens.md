# UX.1.3 Camv — token preview (UX-T0 Camv slice)

Pack: `brand_camv_v1.zip` (sha256 `f1c9a26ad7e0f03bf9328c95ea072ad5a2722b471cf8b91e624c622d66f7b3ef`, 26 files, `~/Downloads` on the Mac mini, 2026-09-14). It was already in the repo as `brand-assets/` byte for byte; this slice moves it unchanged to `packages/ui/brand/camv/` (UX.0.10 path). Per-file sha256 in `packages/ui/brand/camv.sha256`, checked by `tests/brandTokens.test.ts`.

Token file: `packages/ui/src/brand-tokens.ts`. UX.1.3 is transcribed value for value, by UX.1.3's names: colour roles, room tokens (dark), radii, typeface + Arabic companion, plus the UX.0.3 scale. `tests/brandTokens.test.ts` pins every value against UX.1.3, typed independently of the token file. Gosi's diff target is the UX.1.3 table.

| Token                                | Value                                                                                                                                                           |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `primary` · `ink` · `info`           | `#102A5C` Camv Ink                                                                                                                                              |
| `accent`                             | `#F06C62` Camv Coral. Carries Ink text (4.66:1). White on Coral is 2.99:1, so it is used for icons ≥ 24 px only and never for text                              |
| `secondary-text`                     | `#536174` Camv Slate (5.88:1 on Mist)                                                                                                                           |
| `surface` · `surface-alt` · `border` | `#F5F7FA` · `#FFFFFF` · `#DDE3EC`                                                                                                                               |
| semantic                             | success `#1F8A5B` · warning `#B7791F` · danger `#B42318`                                                                                                        |
| room (dark)                          | bg `#0B1B3A` · tiles `#13264C` · controls `#1B335F` · text `#F5F7FA` · speaking ring `#7FD1B9`                                                                  |
| radii                                | sm 6 · md 8 · lg 12 · tile 12 · full 999                                                                                                                        |
| type                                 | Noto Sans 400/700. The woff2 files are converted from the pack's TTFs with fontTools; the Arabic companion is Noto Sans Arabic 400/700 woff2 (OFL), self-hosted |

Not in UX.1.3: `derived` in the token file holds the LiveKit prefab ramp the room already used (bg2..bg5, fg3/fg4, Coral hover/pressed). It was moved out of `styles/globals.css` unchanged so no other file carries a hex literal, and it is retired by the UX.6.5 room book.

## Token preview approval (UX.0.10 / X.2-9)

Page: `/brand` (static, `noindex`).

| Shot                           | File                    |
| ------------------------------ | ----------------------- |
| Desktop 1440, EN               | `tokens-desktop-en.png` |
| Desktop 1440, AR (RTL section) | `tokens-desktop-ar.png` |
| Mobile 390, EN                 | `tokens-mobile-en.png`  |
| Mobile 390, AR (RTL section)   | `tokens-mobile-ar.png`  |

Measurements on the local production build (`next build`, standalone `server.js`, Playwright Chromium):

- `scrollWidth` is 1440 at 1440 and 390 at 390.
- 0 failed requests and 0 third-party hosts.
- Faces loaded: Noto Sans 400/700 and Noto Sans Arabic 400/700.

## Visual change declared: LiveKit theme now applies (camv#15 review 5503895535)

On main 459503c the `[data-lk-theme='default']` override in `styles/globals.css` was dead. LiveKit's own rule has the same specificity and is emitted later, so it won. This PR raises the selector to `:root [data-lk-theme='default']`, so the Camv palette now reaches the prejoin and the room. **The room background changes from LiveKit #111 to Camv Ink**, and controls change from neutral grey to the navy ramp.

All Coral surfaces that carry text or icons use Ink text and stay on Coral in every state. The darker Coral steps fail with Ink: hover 3.72:1, pressed 3.12:1. Mic, camera and chat controls stay on the navy ramp with white icons.

Computed on local production builds (Playwright, 1440 px; room controls rendered inside the themed `<main>` with LiveKit's markup):

| Surface              | main 459503c                | this PR               |
| -------------------- | --------------------------- | --------------------- |
| `--lk-bg`            | `#111`                      | Ink                   |
| prejoin Join         | white on Coral **2.99**     | Ink on Coral **4.66** |
| prejoin Join :hover  | white on coral-hover 3.75   | Ink on Coral 4.66     |
| Leave                | white on Coral **2.99**     | Ink on Coral 4.66     |
| Leave :hover         | white on coral-hover 3.75   | Ink on Coral 4.66     |
| screen share on      | white on LiveKit blue 3.40  | Ink on Coral 4.66     |
| start audio          | white on LiveKit blue 3.40  | Ink on Coral 4.66     |
| mic / camera         | white on grey 16.67         | white on navy 10.12   |
| mic :hover / pressed | white on grey 14.16 / 11.90 | white on navy 8.52    |

Notes:

- The Join button is disabled (opacity 0.5) until a username is entered; this is LiveKit's behaviour and is unchanged. It was measured enabled.
- Settings menu selection borders (camera background, quality) change from LiveKit blue to Coral.

Shots: `prejoin-desktop.png`, `room-controls.png`.

## Status badges

/brand badges now use Ink text on white (13.93:1), with the semantic colour shown as border and dot. White 12 px text on success (4.33:1) and on warning (3.64:1) failed AA.

Ahmed: _(line and date — 24 h silence = approved, UX.0.10)_
