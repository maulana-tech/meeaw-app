// @vitest-environment happy-dom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Steps } from "../src/components/landing/Steps";

function mockReducedMotion(reduce: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: reduce && query.includes("reduce"),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
}

const tab = (name: RegExp) => screen.getByRole("tab", { name });

beforeEach(() => {
  vi.useFakeTimers();
  mockReducedMotion(false);
});
afterEach(() => {
  vi.useRealTimers();
});

describe("How it works stepper", () => {
  it("shows the first step's mock and switches on click", () => {
    render(<Steps />);
    expect(tab(/claim your link/i)).toHaveAttribute("aria-selected", "true");
    const panel = screen.getByRole("tabpanel");
    expect(panel).toHaveTextContent("Claim your username");
    expect(panel).toHaveAccessibleName(/claim your link/i);

    fireEvent.click(tab(/share it with clients/i));
    expect(tab(/share it with clients/i)).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Pay 300 USDC");
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Covered");
  });

  it("supports arrow keys with roving focus", () => {
    render(<Steps />);
    const first = tab(/claim your link/i);
    expect(first).toHaveAttribute("tabindex", "0");
    expect(tab(/withdraw privately/i)).toHaveAttribute("tabindex", "-1");

    fireEvent.keyDown(first, { key: "ArrowUp" });
    expect(tab(/withdraw privately/i)).toHaveAttribute("aria-selected", "true");
    expect(tab(/withdraw privately/i)).toHaveFocus();
    expect(screen.getByRole("tabpanel")).toHaveTextContent(
      "Not linked to any deposit",
    );

    fireEvent.keyDown(tab(/withdraw privately/i), { key: "Home" });
    expect(tab(/claim your link/i)).toHaveAttribute("aria-selected", "true");
  });

  it("advances on its own, and stops once the visitor takes over", () => {
    render(<Steps />);
    act(() => {
      vi.advanceTimersByTime(6000);
    });
    expect(tab(/share it with clients/i)).toHaveAttribute(
      "aria-selected",
      "true",
    );

    fireEvent.click(tab(/claim your link/i));
    act(() => {
      vi.advanceTimersByTime(20000);
    });
    expect(tab(/claim your link/i)).toHaveAttribute("aria-selected", "true");
  });

  it("never auto-advances for visitors who prefer reduced motion", () => {
    mockReducedMotion(true);
    render(<Steps />);
    act(() => {
      vi.advanceTimersByTime(20000);
    });
    expect(tab(/claim your link/i)).toHaveAttribute("aria-selected", "true");
  });
});
