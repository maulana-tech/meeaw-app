// @vitest-environment happy-dom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FxEstimate } from "../src/components/dashboard/FxEstimate";
import { snapshotFromRates } from "../src/lib/fx";

const state = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("../src/lib/fxClient", () => ({ readReferenceRates: state.read }));
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("mawee:fiat-reference-currency", "IDR");
  state.read.mockReset();
  state.read.mockResolvedValue(
    snapshotFromRates([
      {
        date: new Date().toISOString().slice(0, 10),
        base: "USD",
        quote: "IDR",
        rate: 16500,
      },
    ]),
  );
});
describe("fiat estimate UI", () => {
  it("does not mislabel an empty amount as a provider outage", async () => {
    render(<FxEstimate amount="" asset="USDC" testFunds />);
    expect(await screen.findByText(/Daily reference/)).toBeVisible();
    expect(
      screen.queryByText(/Fiat estimate unavailable/),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/IDR estimate/)).not.toBeInTheDocument();
  });
  it("shows source, date and test-fund limitation without changing the token amount", async () => {
    render(
      <FxEstimate amount="20" asset="AUSD" testFunds allowCurrencyChoice />,
    );
    expect(await screen.findByText(/IDR estimate/)).toHaveTextContent(
      /330,000/,
    );
    expect(screen.getByRole("link", { name: "Frankfurter" })).toHaveAttribute(
      "href",
      "https://frankfurter.dev/",
    );
    expect(screen.getByText(/Payment stays in AUSD/)).toBeVisible();
    expect(screen.getByText(/no cash value/)).toBeVisible();
    expect(state.read).toHaveBeenCalledWith();
  });
  it("persists only currency and shares changes with another estimate", async () => {
    render(
      <>
        <FxEstimate amount="20" asset="USDC" testFunds allowCurrencyChoice />
        <FxEstimate amount="10" asset="USDC" testFunds />
      </>,
    );
    await screen.findAllByText(/IDR estimate/);
    fireEvent.change(
      screen.getByRole("combobox", { name: "Estimate currency" }),
      { target: { value: "USD" } },
    );
    expect(screen.queryByText(/IDR estimate/)).not.toBeInTheDocument();
    expect(localStorage.length).toBe(1);
    expect(localStorage.getItem("mawee:fiat-reference-currency")).toBe("USD");
  });
  it("labels failures and cached fallback", async () => {
    state.read.mockRejectedValueOnce(new Error("down"));
    const { rerender } = render(
      <FxEstimate amount="20" asset="USDC" testFunds />,
    );
    expect(await screen.findByText(/Fiat estimate unavailable/)).toBeVisible();
    state.read.mockResolvedValue({
      ...snapshotFromRates([
        {
          date: new Date().toISOString().slice(0, 10),
          base: "USD",
          quote: "EUR",
          rate: 0.9,
        },
      ]),
      stale: true,
    });
    localStorage.setItem("mawee:fiat-reference-currency", "EUR");
    fireEvent(window, new Event("storage"));
    rerender(<FxEstimate amount="20" asset="USDC" testFunds />);
    await waitFor(() =>
      expect(screen.getByText(/Cached reference/)).toBeVisible(),
    );
  });
});
