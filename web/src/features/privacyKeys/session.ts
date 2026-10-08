import { accountForGeneration, erasePrivacyAccounts } from "./keyRing";
import type { LocalPrivacyKeyring } from "./types";

let session: LocalPrivacyKeyring | null = null;

export function getPrivacyKeyring(): LocalPrivacyKeyring | null {
  return session;
}
export function installPrivacyKeyring(ring: LocalPrivacyKeyring): void {
  accountForGeneration(ring, ring.activeGeneration);
  if (session === ring) return;
  clearPrivacyKeyring();
  session = ring;
  if (typeof window !== "undefined")
    window.dispatchEvent(new Event("mawee:privacy-keys-changed"));
}
export function clearPrivacyKeyring(): void {
  if (session) erasePrivacyAccounts(session.accounts);
  session = null;
  if (typeof window !== "undefined")
    window.dispatchEvent(new Event("mawee:privacy-keys-changed"));
}
