# Mobile PWA and AUSD sending

Branch: `feature/mobile-pwa`, based on local `feature/gasless-sponsorship-budget`
at `6909ca0`. The user subsequently authorized committing and pushing this work,
merging its PR into the verified default branch `monad-migration`, then merging
a promotion PR from `monad-migration` into `dev`. Validation below concerns the
local implementation; remote merge and deployment status are reported separately.

## Implemented

- App Router manifest, regular 192/512 PNG icons and a separate maskable icon,
  reusing the existing pixel-cat SVG.
- Apple web-app metadata, existing Apple touch icon, viewport cover and dashboard
  safe-area spacing, including the fixed mobile navigation.
- Root service-worker registration with update caching disabled and explicit
  no-store worker headers.
- A network-only navigation worker that caches only a self-contained offline
  HTML page. No API interception, private-data cache, background payment queue
  or forced reload during worker updates.
- Android installation offer and Safari installation instructions. The deferred
  browser offer is retained in page memory when it arrives before dashboard
  login. Dismissal persists only a preference flag.
- An AUSD shortcut that validates an eligible configured pool, requires unlock,
  checks pending transfers and reopens the original operation after a reload.
  The chosen pool is passed directly to Send even if storing the dashboard asset
  preference is unavailable.
  Late results after an account switch/unmount are ignored; query failure cannot
  open a new payment.
- Larger Send inputs, no username autocorrect and wrapping for long recipients.
  The success mascot appears only for confirmed operation status.

## Verification

- The latest broader run exercised 12 suites / 52 tests: 51 passed and the newly
  added pre-login install-offer regression reproduced the missing offer.
- After fixing that regression, the three affected PWA/navigation suites passed
  14/14. The other nine suites' 38 passing tests exercise unchanged code. The
  verified union is 12 suites / 52 tests; this is focused coverage, not the entire
  web suite.
- Scoped Biome: 17 files, exit 0, no remaining diagnostics.
- Fresh pre-delivery PWA checks: 5 suites / 29 tests passed with exit 0.
- Worker and asset-generator JavaScript syntax checks passed.
- Final source TypeScript passed with exit 0.
- Final `pnpm build:local` passed with exit 0, including static page generation
  and build tracing, after the prompt-retention, captured-pool and safe-area changes.
- Against that local production server, manifest, worker, offline HTML and all
  three icons returned HTTP 200 with the expected content types. The worker
  response carried no-cache/no-store headers. Rendered HTML included manifest,
  mobile capability, Apple title/touch icon, viewport cover and theme color.
- The maskable icon was visually inspected as a local image.

The suite retains existing pnpm configuration, Vitest deprecation and Headless
UI animation-polyfill warnings. They were not suppressed or changed by this work.

## Limits

Browser inspection of localhost was rejected by the browser URL security policy.
No alternate browser or headless workaround was attempted. Desktop/mobile layout,
actual browser service-worker operation, Android/iPhone installation, passkey
recovery on a physical device, and a funded Monad testnet AUSD transfer remain
unverified. Tests cover worker code, component behavior and pending-operation
recovery; HTTP checks do not establish installability on hardware.

Only mock testnet assets are documented. Agora's acceptance of PWA, mock AUSD,
Mera's onboarding role and bounty stacking still need organizer confirmation.
No local-currency conversion, numeric settlement-time promise, invoice subsystem,
email service or new financial contract was added.
