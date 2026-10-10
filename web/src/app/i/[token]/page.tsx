import type { Metadata } from "next";
import { InvoiceCheckout } from "../../../components/invoices/InvoiceCheckout";

export const metadata: Metadata = {
  title: "Invoice | Meaw",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};
export default async function PublicInvoicePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <InvoiceCheckout key={token} token={token} />;
}
