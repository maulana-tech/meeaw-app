// @vitest-environment happy-dom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

type SettingsQueryData = {
  serviceAvailable: boolean;
  settings: {
    email: string;
    enabled: boolean;
    events: {
      invoicePaid: boolean;
      requestReceived: boolean;
      requestPaid: boolean;
    };
  } | null;
} | null;

type PrivyUserMock = {
  email?: { address: string };
  google?: { email: string };
} | null;

const mocks = vi.hoisted(() => ({
  privyUser: null as PrivyUserMock,
  queryData: null as SettingsQueryData,
  isLoading: false,
  refetch: vi.fn(),
  updateMutateAsync: vi.fn(),
  isUpdating: false,
  testMutateAsync: vi.fn(),
  isTesting: false,
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@privy-io/react-auth", () => ({
  usePrivy: () => ({
    user: mocks.privyUser,
  }),
}));

vi.mock("../src/trpc/react", () => ({
  trpc: {
    notifications: {
      getSettings: {
        useQuery: () => ({
          data: mocks.queryData,
          isLoading: mocks.isLoading,
          refetch: mocks.refetch,
        }),
      },
      updateSettings: {
        useMutation: () => ({
          mutateAsync: mocks.updateMutateAsync,
          isPending: mocks.isUpdating,
        }),
      },
      sendTest: {
        useMutation: () => ({
          mutateAsync: mocks.testMutateAsync,
          isPending: mocks.isTesting,
        }),
      },
    },
  },
}));

vi.mock("sonner", () => ({
  toast: {
    success: mocks.toastSuccess,
    error: mocks.toastError,
  },
}));

import { EmailNotificationsRow } from "../src/features/notifications/EmailNotificationsRow";

describe("EmailNotificationsRow Component", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.privyUser = null;
    mocks.queryData = null;
    mocks.isLoading = false;
    mocks.isUpdating = false;
    mocks.isTesting = false;
    mocks.refetch.mockResolvedValue(undefined);
    mocks.updateMutateAsync.mockResolvedValue({ success: true });
    mocks.testMutateAsync.mockResolvedValue({ success: true });
  });

  it("renders 'Service not configured' badge when serviceAvailable is false", () => {
    mocks.queryData = { serviceAvailable: false, settings: null };
    render(<EmailNotificationsRow />);

    expect(screen.getByText("Service not configured")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Email notifications" }),
    ).toBeInTheDocument();
  });

  it("renders 'Active' badge and prefilled values when serviceAvailable is true and enabled", () => {
    mocks.queryData = {
      serviceAvailable: true,
      settings: {
        email: "alice@example.com",
        enabled: true,
        events: {
          invoicePaid: true,
          requestReceived: false,
          requestPaid: true,
        },
      },
    };
    render(<EmailNotificationsRow />);

    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByLabelText(/Enable email notifications/i)).toBeChecked();
    expect(screen.getByLabelText(/Notification Email/i)).toHaveValue(
      "alice@example.com",
    );
    expect(screen.getByLabelText(/Invoice settled/i)).toBeChecked();
    expect(
      screen.getByLabelText(/Payment request received/i),
    ).not.toBeChecked();
    expect(screen.getByLabelText(/Payment request settled/i)).toBeChecked();
  });

  it("prefills email from Privy user object when no saved settings exist", async () => {
    const user = userEvent.setup();
    mocks.privyUser = { email: { address: "privy-user@example.com" } };
    mocks.queryData = { serviceAvailable: true, settings: null };

    render(<EmailNotificationsRow />);

    // By default, disabled
    const masterToggle = screen.getByLabelText(/Enable email notifications/i);
    expect(masterToggle).not.toBeChecked();

    // Enable notifications to reveal email input
    await user.click(masterToggle);
    expect(screen.getByLabelText(/Notification Email/i)).toHaveValue(
      "privy-user@example.com",
    );
  });

  it("dispatches save mutation when form is submitted with valid email", async () => {
    const user = userEvent.setup();
    mocks.queryData = { serviceAvailable: true, settings: null };

    render(<EmailNotificationsRow />);

    await user.click(screen.getByLabelText(/Enable email notifications/i));
    const emailInput = screen.getByLabelText(/Notification Email/i);
    await user.clear(emailInput);
    await user.type(emailInput, "bob@example.com");

    await user.click(screen.getByRole("button", { name: /Save preferences/i }));

    await waitFor(() => {
      expect(mocks.updateMutateAsync).toHaveBeenCalledWith({
        email: "bob@example.com",
        enabled: true,
        events: {
          invoicePaid: true,
          requestReceived: true,
          requestPaid: true,
        },
      });
    });
    expect(mocks.refetch).toHaveBeenCalled();
    expect(mocks.toastSuccess).toHaveBeenCalledWith(
      "Notification preferences saved",
    );
  });

  it("shows error toast when saving with invalid email", async () => {
    const user = userEvent.setup();
    mocks.queryData = { serviceAvailable: true, settings: null };

    render(<EmailNotificationsRow />);

    await user.click(screen.getByLabelText(/Enable email notifications/i));
    const emailInput = screen.getByLabelText(/Notification Email/i);
    await user.clear(emailInput);
    await user.type(emailInput, "not-an-email");

    await user.click(screen.getByRole("button", { name: /Save preferences/i }));

    expect(mocks.toastError).toHaveBeenCalledWith(
      "Please enter a valid email address.",
    );
    expect(mocks.updateMutateAsync).not.toHaveBeenCalled();
  });

  it("sends test email when Send test email button is clicked", async () => {
    const user = userEvent.setup();
    mocks.queryData = {
      serviceAvailable: true,
      settings: {
        email: "test@example.com",
        enabled: true,
        events: {
          invoicePaid: true,
          requestReceived: true,
          requestPaid: true,
        },
      },
    };

    render(<EmailNotificationsRow />);

    const sendTestBtn = screen.getByRole("button", {
      name: /Send test email/i,
    });
    expect(sendTestBtn).toBeInTheDocument();

    await user.click(sendTestBtn);

    await waitFor(() => {
      expect(mocks.testMutateAsync).toHaveBeenCalled();
    });
    expect(mocks.toastSuccess).toHaveBeenCalledWith(
      "Test email sent! Check your inbox.",
    );
  });
});
