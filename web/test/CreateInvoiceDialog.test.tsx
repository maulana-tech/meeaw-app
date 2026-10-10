// @vitest-environment happy-dom
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CreateInvoiceDialog } from "../src/components/invoices/CreateInvoiceDialog";

const state = vi.hoisted(() => ({ create: vi.fn(), address: "alice" }));
vi.mock("../src/trpc/client", () => ({
  api: { invoices: { create: { mutate: state.create } } },
}));
vi.mock("../src/components/WalletProvider", () => ({
  useWallet: () => ({ username: "alice", address: state.address }),
}));
vi.mock("../src/lib/pools", () => ({
  activePoolFor: () => ({
    role: "active",
    tokenDecimals: 6,
    requestCapable: true,
  }),
}));
beforeEach(() => {
  state.create.mockReset().mockResolvedValue({ id: "invoice" });
  state.address = "alice";
});
function fill() {
  fireEvent.change(screen.getByLabelText("Invoice number"), {
    target: { value: "inv-001" },
  });
  fireEvent.change(screen.getByLabelText("Client name"), {
    target: { value: "Client" },
  });
  fireEvent.change(screen.getByLabelText("Description 1"), {
    target: { value: "Design" },
  });
  fireEvent.change(screen.getByLabelText("Quantity 1"), {
    target: { value: "2" },
  });
  fireEvent.change(screen.getByLabelText(/Unit price 1/), {
    target: { value: "1.25" },
  });
}
describe("create invoice", () => {
  it("previews exact total and creates a normalized invoice", async () => {
    const onCreated = vi.fn();
    render(
      <CreateInvoiceDialog
        open
        onOpenChange={() => {}}
        onCreated={onCreated}
      />,
    );
    fill();
    expect(screen.getByText("2.5 USDC")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Create invoice" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledOnce());
    expect(state.create.mock.calls[0][0]).toMatchObject({
      username: "alice",
      number: "INV-001",
      asset: "USDC",
      items: [{ description: "Design", quantity: 2, unitPrice: "1.25" }],
    });
  });
  it("does not publish zero-value invoices", async () => {
    render(
      <CreateInvoiceDialog open onOpenChange={() => {}} onCreated={vi.fn()} />,
    );
    fill();
    fireEvent.change(screen.getByLabelText(/Unit price 1/), {
      target: { value: "0" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create invoice" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/total/i);
    expect(state.create).not.toHaveBeenCalled();
  });
  it("ignores a creation result after the wallet changes", async () => {
    let finish!: (value: { id: string }) => void;
    state.create.mockReturnValue(
      new Promise((r) => {
        finish = r;
      }),
    );
    const onCreated = vi.fn();
    const view = render(
      <CreateInvoiceDialog
        open
        onOpenChange={() => {}}
        onCreated={onCreated}
      />,
    );
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Create invoice" }));
    await waitFor(() => expect(state.create).toHaveBeenCalledOnce());
    state.address = "bob";
    view.rerender(
      <CreateInvoiceDialog
        open
        onOpenChange={() => {}}
        onCreated={onCreated}
      />,
    );
    await act(async () => finish({ id: "invoice" }));
    expect(onCreated).not.toHaveBeenCalled();
  });
});
