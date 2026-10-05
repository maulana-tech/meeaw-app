// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  DashboardBackground,
  useDashboardMode,
} from "../src/components/dashboard/DashboardBackground";

const css = readFileSync(resolve(__dirname, "../src/app/globals.css"), "utf8");
const dashboardCss = css.slice(css.indexOf("body:has(.dashboard-app) {"));

function ModeProbe() {
  const { mode, toggleMode } = useDashboardMode();
  return (
    <button type="button" onClick={toggleMode}>
      {mode}
    </button>
  );
}

describe("DashboardBackground", () => {
  beforeEach(() => {
    delete document.documentElement.dataset.dashMode;
    window.localStorage.clear();
  });

  it("renders the dashboard canvas without a background image", () => {
    const { container } = render(
      <DashboardBackground>
        <p>Dashboard content</p>
      </DashboardBackground>,
    );

    expect(container.firstElementChild).toHaveClass(
      "theme-product",
      "dashboard-app",
    );
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("Dashboard content")).toBeInTheDocument();
  });

  it("toggles between light and dark and remembers the choice", async () => {
    document.documentElement.dataset.dashMode = "light";
    render(<ModeProbe />);

    await userEvent.click(screen.getByRole("button", { name: "light" }));

    expect(screen.getByRole("button", { name: "dark" })).toBeInTheDocument();
    expect(document.documentElement.dataset.dashMode).toBe("dark");
    expect(window.localStorage.getItem("mawee.dashboard.mode")).toBe("dark");
  });

  it("uses ink on paper (and paper on ink in dark mode), without gradients", () => {
    expect(dashboardCss).toContain("--dash-bg: rgb(250 247 240);");
    expect(dashboardCss).toContain("--dash-fg: rgb(21 19 16);");
    expect(dashboardCss).toMatch(
      /html\[data-dash-mode="dark"\] body:has\(\.dashboard-app\) \{[^}]*--dash-bg: rgb\(21 19 16\);[^}]*--dash-fg: rgb\(250 247 240\);/,
    );
    expect(dashboardCss).not.toMatch(/gradient\(/);
  });
});
