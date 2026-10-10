import { sponsorshipUiFixture } from "./helpers/sponsorshipUiFixture";

vi.mock("../src/features/sponsorship/useSponsorship", () => ({
  useSponsorship: sponsorshipUiFixture,
}));

// @vitest-environment happy-dom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

const ports = vi.hoisted(() => ({
  prepare: vi.fn(async () => ({
    from: 0,
    to: 1,
    newKeys: {
      notePubkey: `0x${"1".repeat(64)}`,
      viewPubkey: `0x${"2".repeat(64)}`,
    },
  })),
  confirm: vi.fn(),
  check: vi.fn(),
  clear: vi.fn(),
}));
vi.mock("../src/features/privacyKeys/usePrivacyKeyRotation", () => ({
  usePrivacyKeyRotation: () => ({
    state: { activeGeneration: 0, pending: null },
    operation: null,
    review: null,
    isWorking: false,
    error: null,
    prepare: ports.prepare,
    confirm: ports.confirm,
    check: ports.check,
    clear: ports.clear,
  }),
}));
vi.mock("../src/components/WalletProvider", () => ({
  useWallet: () => ({
    recoveryMethod: "pin",
    username: "alice",
    accountUnlocked: true,
    address: "0x1111111111111111111111111111111111111111",
  }),
}));

import { RotatePrivacyKeyDialog } from "../src/components/dashboard/RotatePrivacyKeyDialog";

describe("routine key rotation review", () => {
  it("requires re-auth and explains preserved funds before calling confirmation", async () => {
    const user = userEvent.setup();
    render(<RotatePrivacyKeyDialog open onOpenChange={vi.fn()} />);
    await user.type(screen.getByLabelText("Current recovery PIN"), "123456");
    await user.click(screen.getByRole("button", { name: "Review rotation" }));
    expect(ports.prepare).toHaveBeenCalledWith("123456");
    expect(
      await screen.findByText(/No private funds are moved/),
    ).toBeInTheDocument();
    expect(ports.confirm).not.toHaveBeenCalled();
  });
});
