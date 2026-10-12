// @vitest-environment happy-dom
import { render, screen } from "@testing-library/react";
import { Suspense } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  unsubscribeMutateAsync: vi.fn(),
}));

vi.mock("@/trpc/react", () => ({
  trpc: {
    notifications: {
      unsubscribe: {
        useMutation: () => ({
          mutateAsync: mocks.unsubscribeMutateAsync,
        }),
      },
    },
  },
}));

import UnsubscribePage from "../src/app/unsubscribe/[token]/page";

function createResolvedPromise<T>(value: T): Promise<T> {
  const promise = Promise.resolve(value) as Promise<T> & {
    status?: string;
    value?: T;
  };
  promise.status = "fulfilled";
  promise.value = value;
  return promise;
}

describe("UnsubscribePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function renderPage(token = "tok-valid-123") {
    const params = createResolvedPromise({ token });
    return render(
      <Suspense fallback={<div>Loading...</div>}>
        <UnsubscribePage params={params} />
      </Suspense>,
    );
  }

  it("renders pending state initially while unsubscribe mutation is processing", async () => {
    mocks.unsubscribeMutateAsync.mockImplementation(
      () => new Promise(() => {}),
    );

    renderPage("pending-token");

    expect(
      screen.getByRole("heading", { name: "Unsubscribing…" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Updating your notification preferences…"),
    ).toBeInTheDocument();
    expect(mocks.unsubscribeMutateAsync).toHaveBeenCalledWith({
      token: "pending-token",
    });
  });

  it("renders 'Unsubscribed' message on successful mutation resolution", async () => {
    mocks.unsubscribeMutateAsync.mockResolvedValue({ success: true });

    renderPage("tok-success");

    expect(
      await screen.findByRole("heading", { name: "Unsubscribed" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "You will no longer receive payment notification emails from Meaw.",
      ),
    ).toBeInTheDocument();

    const returnLink = screen.getByRole("link", { name: "Return to Meaw" });
    expect(returnLink).toBeInTheDocument();
    expect(returnLink).toHaveAttribute("href", "/dashboard");
  });

  it("renders 'Invalid Link' message when unsubscribe mutation returns success: false", async () => {
    mocks.unsubscribeMutateAsync.mockResolvedValue({ success: false });

    renderPage("invalid-token");

    expect(
      await screen.findByRole("heading", { name: "Invalid Link" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "This unsubscribe link is invalid or has already been processed.",
      ),
    ).toBeInTheDocument();

    const returnLink = screen.getByRole("link", { name: "Return to Meaw" });
    expect(returnLink).toBeInTheDocument();
    expect(returnLink).toHaveAttribute("href", "/dashboard");
  });

  it("renders 'Invalid Link' message when unsubscribe mutation throws an error", async () => {
    mocks.unsubscribeMutateAsync.mockRejectedValue(
      new Error("Rate limit exceeded"),
    );

    renderPage("error-token");

    expect(
      await screen.findByRole("heading", { name: "Invalid Link" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "This unsubscribe link is invalid or has already been processed.",
      ),
    ).toBeInTheDocument();
  });
});
