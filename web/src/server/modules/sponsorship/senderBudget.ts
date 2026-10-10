import "server-only";
import type { PolicyState } from "../../../features/sponsorship/types";
import type { SponsorLedger } from "./ledger.service";
export type SponsorBudgetPort = {
  ledger: SponsorLedger;
  policy: () => PolicyState;
};
