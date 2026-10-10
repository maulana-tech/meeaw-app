// @vitest-environment happy-dom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mocks = vi.hoisted(() => ({
  disconnect: vi.fn(),
  usePathname: vi.fn(() => "/dashboard"),
  pendingRequestsCount: 0,
}));

vi.mock("next/navigation", () => ({
  usePathname: mocks.usePathname,
}));
vi.mock("../src/components/WalletProvider", () => ({
  useWallet: () => ({ username: "toreno", disconnect: mocks.disconnect }),
}));
vi.mock("../src/features/requests/hooks/usePendingRequestsCount", () => ({
  usePendingRequestsCount: () => ({
    count: mocks.pendingRequestsCount,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
}));

import { DashboardShell } from "../src/components/dashboard/DashboardShell";

describe("DashboardShell", () => {
  beforeEach(() => {
    mocks.usePathname.mockReturnValue("/dashboard");
    mocks.pendingRequestsCount = 0;
  });

  it("provides the page's main-content landmark", () => {
    render(
      <DashboardShell>
        <div>Dashboard content</div>
      </DashboardShell>,
    );

    expect(screen.getByRole("main")).toHaveAttribute("id", "main-content");
    expect(screen.queryByRole("navigation")).toBeNull();
  });

  it("links every dashboard section and marks the current one", () => {
    mocks.usePathname.mockReturnValue("/history");
    render(
      <DashboardShell navigation>
        <div>History content</div>
      </DashboardShell>,
    );

    const nav = screen.getByRole("navigation", { name: "Dashboard" });
    const links = within(nav).getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/dashboard",
      "/links",
      "/invoices",
      "/withdraw",
      "/history",
      "/requests",
      "/settings",
    ]);
    expect(within(nav).getByRole("link", { name: "History" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(
      within(nav).getByRole("link", { name: "Overview" }),
    ).not.toHaveAttribute("aria-current");
    expect(
      screen.getByRole("navigation", { name: "Dashboard tabs" }),
    ).toBeInTheDocument();
  });

  it("signs out from the account menu", async () => {
    const user = userEvent.setup();
    render(
      <DashboardShell navigation>
        <div>Dashboard content</div>
      </DashboardShell>,
    );

    await user.click(
      screen.getByRole("button", { name: "@toreno account menu" }),
    );
    await user.click(await screen.findByRole("menuitem", { name: "Sign out" }));
    expect(mocks.disconnect).toHaveBeenCalledOnce();
  });

  it("keeps the dashboard chrome mounted while the route content changes", () => {
    const { rerender } = render(
      <DashboardShell navigation>
        <div>Overview content</div>
      </DashboardShell>,
    );
    const accountMenu = document.querySelector(
      "#dashboard-account-menu-trigger",
    );

    mocks.usePathname.mockReturnValue("/history");
    rerender(
      <DashboardShell navigation>
        <div>History content</div>
      </DashboardShell>,
    );

    expect(document.querySelector("#dashboard-account-menu-trigger")).toBe(
      accountMenu,
    );
    expect(screen.getByText("History content")).toBeInTheDocument();
  });

  it("renders a badge with the number of pending requests on the Requests navigation item", () => {
    mocks.pendingRequestsCount = 5;
    render(
      <DashboardShell navigation>
        <div>Requests content</div>
      </DashboardShell>,
    );

    const nav = screen.getByRole("navigation", { name: "Dashboard" });
    const requestsLink = within(nav).getByRole("link", { name: /Requests/i });
    expect(within(requestsLink).getByText("5")).toBeInTheDocument();
  });
});
