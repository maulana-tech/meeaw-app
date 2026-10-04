// @vitest-environment happy-dom
import { render, screen } from "@testing-library/react";
import { ProblemStatement } from "../src/components/landing/ProblemStatement";

const gsapMock = vi.hoisted(() => ({
  context: vi.fn((callback: () => void) => {
    callback();
    return { revert: vi.fn() };
  }),
  fromTo: vi.fn(),
  matchMedia: vi.fn(() => ({
    add: vi.fn((_query: unknown, callback: (context: unknown) => void) => {
      callback({ conditions: { reduceMotion: false } });
    }),
    revert: vi.fn(),
  })),
  registerPlugin: vi.fn(),
  set: vi.fn(),
}));

vi.mock("gsap", () => ({
  default: gsapMock,
}));

vi.mock("gsap/ScrollTrigger", () => ({
  ScrollTrigger: { refresh: vi.fn() },
}));

describe("ProblemStatement scroll reveal", () => {
  it("leads with the gradient sentence and reveals the rest word by word", () => {
    const { container } = render(<ProblemStatement />);

    expect(
      screen.getByRole("heading", {
        name: /public wallets were never designed for business/i,
      }),
    ).toBeInTheDocument();
    expect(container.querySelector(".text-nebula")).toHaveTextContent(
      "Public wallets were never designed for business.",
    );
    // Nested emphasis is split into words too.
    expect(screen.getByText("earn,")).toHaveClass("word");
    expect(screen.getByText("earn,").parentElement).toHaveClass("font-normal");
    expect(container.querySelectorAll(".word").length).toBeGreaterThan(20);
    expect(gsapMock.fromTo).toHaveBeenCalled();
  });
});
