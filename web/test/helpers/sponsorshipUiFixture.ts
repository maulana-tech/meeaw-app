import type { QuotaStatus } from "../../src/features/sponsorship/types";
export const sponsorshipUiStatus: QuotaStatus = {
  configured: true,
  available: true,
  reason: null,
  limit: 20,
  used: 1,
  reserved: 1,
  remaining: 18,
  resetAt: "2026-10-10T00:00:00Z",
};
export function sponsorshipUiFixture() {
  return {
    status: sponsorshipUiStatus,
    loading: false,
    refresh: async () => sponsorshipUiStatus,
  };
}
