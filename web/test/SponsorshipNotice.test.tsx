// @vitest-environment happy-dom
import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { SponsorshipNotice } from "../src/features/sponsorship/SponsorshipNotice";
import type { QuotaStatus } from "../src/features/sponsorship/types";

const quota: QuotaStatus = {
  configured: true,
  available: true,
  reason: null,
  limit: 20,
  used: 1,
  reserved: 1,
  remaining: 18,
  resetAt: "2026-10-10T00:00:00Z",
};
it("explains the single action allowance without operator details", () => {
  render(<SponsorshipNotice status={quota} loading={false} />);
  expect(screen.getByRole("status")).toHaveTextContent(/18.*20/);
  expect(screen.getByRole("status")).toHaveTextContent(
    /preparation.*included/i,
  );
  expect(screen.getByRole("status")).not.toHaveTextContent(
    /MON|RPC|MongoDB|private key/i,
  );
});
it.each([
  "quota",
  "budget",
  "anonymous-budget",
  "balance",
  "cost",
  "capacity",
  "configuration",
  "initializing",
  "rpc",
] as const)("offers understandable recovery for %s", (reason) => {
  render(
    <SponsorshipNotice
      status={{
        ...quota,
        available: false,
        reason,
        remaining: reason === "quota" ? 0 : 18,
      }}
      loading={false}
    />,
  );
  expect(screen.getByRole("status")).toHaveTextContent(
    /gasless|quota|allowance/i,
  );
  expect(screen.getByRole("status")).not.toHaveTextContent(
    /RPC|MongoDB|private key|Gwei/i,
  );
});
it("shows unknown availability and loading separately", () => {
  const { rerender } = render(
    <SponsorshipNotice status={null} loading={true} />,
  );
  expect(screen.getByRole("status")).toHaveTextContent(/checking/i);
  rerender(<SponsorshipNotice status={null} loading={false} />);
  expect(screen.getByRole("status")).toHaveTextContent(/could not|couldn't/i);
});
it("does not label a public payer's shared allowance as personal quota", () => {
  render(<SponsorshipNotice status={quota} loading={false} public />);
  expect(screen.getByRole("status")).toHaveTextContent(/gasless/i);
  expect(screen.getByRole("status")).not.toHaveTextContent(/18|20|your quota/i);
});
