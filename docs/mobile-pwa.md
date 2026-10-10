# Meaw on your phone

Meaw can be installed from a secure web origin and opened from the home screen.
It uses the same account, privacy keys and payment operations as the browser app.
Balances on Monad testnet are mock funds with no real value.

## Install

- Android: open Meaw in Chrome. Use **Install Meaw** on the dashboard when the
  browser offers installation, or use the browser's install menu.
- iPhone/iPad: open Meaw in Safari, choose **Share**, then **Add to Home Screen**.
- A dismissed dashboard suggestion stays dismissed on that browser; installation
  remains available through its browser menu. Suggestions are hidden when already
  running standalone.

Production must use HTTPS. Localhost is suitable for local development, but an
ordinary HTTP address on your Wi-Fi network is not a secure passkey/PWA origin.
Opening the installed app does not unlock privacy keys automatically: use the
existing passkey or PIN recovery flow.

## Send AUSD

The dashboard's **Send AUSD** shortcut selects the configured active AUSD pool.
It first checks for an unfinished AUSD transfer and reopens that transfer instead
of starting another. If status cannot be checked, it asks you to reconnect.

Enter a registered recipient's `@username` and amount, review, then confirm.
The existing private Send flow handles encryption, proof preparation and relayer
submission. Sponsorship availability and existing spending limits still apply.
AUSD sending is hidden when no eligible AUSD pool is configured.

After a reload, use **Send AUSD**, the pending-payment notice or History to reopen
the existing operation. A submitted transaction is displayed as confirming;
success is shown only once the operation reports confirmed settlement.
Preparation can include multiple merge/split steps; no fixed settlement time is
advertised. This is a stablecoin payment, not bank withdrawal or local-currency
conversion.

## Offline behavior and privacy

The service worker stores only `/offline.html`, a self-contained static page
with an embedded mascot. It never stores account HTML, balances, encrypted notes,
API responses, proof files or authentication credentials in the PWA Cache API.
API, non-navigation and cross-origin requests are not intercepted. There is no
background queue or automatic payment replay. Server errors remain server errors.

When a navigation fails due to a lost connection, the fallback asks you to
reconnect and retry. If you already submitted a payment, check its existing status
before sending again. Worker updates do not force a reload during a payment.
Only older Meaw offline caches are removed during activation.

## Development and verification

The worker is served at `/sw.js` with explicit no-store headers. App Router serves
the manifest at `/manifest.webmanifest`. PNG icons include separate regular and
maskable artwork; regenerate icons and the offline page from the existing SVG:

```powershell
node web/scripts/generate-pwa-icons.mjs
pnpm build:local
pnpm --filter web start:local --port 3100
```

Before submission, test on real Android and iPhone devices:

- Install and launch standalone from the deployed HTTPS URL.
- Sign in, create/unlock a passkey account and recover the same balance after reload.
- Send testnet AUSD between two accounts and inspect confirmed receipt/recipient balance.
- Reopen an unfinished transfer after closing the app without creating another payment.
- Load the app once online, disconnect, navigate, then retry after reconnecting.
- Check keyboard, safe-area spacing and controls in portrait and landscape.

Automated checks and a desktop browser do not establish real-device installation
or a live funded payment. Agora eligibility is separate: acceptance of PWA,
mock AUSD, Mera's onboarding role and bounty stacking still need organizer confirmation.
