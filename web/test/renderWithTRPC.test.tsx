// @vitest-environment happy-dom
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useCreatePaymentLink } from "../src/features/paymentLinks/hooks/useCreatePaymentLink";
import { usePaymentLink } from "../src/features/paymentLinks/hooks/usePaymentLink";
import { renderWithTRPC } from "./renderWithTRPC";

function HookConsumer() {
  const { link, loading } = usePaymentLink(null);
  const { isCreating } = useCreatePaymentLink();
  return (
    <div>{`${link === null ? "no-link" : "link"}:${loading}:${isCreating}`}</div>
  );
}

describe("renderWithTRPC", () => {
  it("provides the tRPC + React Query context to hook-using components", () => {
    renderWithTRPC(<HookConsumer />);
    expect(screen.getByText("no-link:false:false")).toBeInTheDocument();
  });
});
