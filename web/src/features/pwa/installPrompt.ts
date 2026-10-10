export interface InstallEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let pending: InstallEvent | null = null;

export function rememberInstallPrompt(event: Event) {
  event.preventDefault();
  pending = event as InstallEvent;
}

export function getInstallPrompt() {
  return pending;
}

export function clearInstallPrompt() {
  pending = null;
}
