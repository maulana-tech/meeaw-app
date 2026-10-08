import type { Metadata } from "next";
import { VerifyReceipt } from "../../components/receipts/VerifyReceipt";
export const metadata: Metadata = {
  title: "Verify a receipt | Meaw",
  description:
    "Check a shared Meaw note proof without uploading private details.",
};
export default function VerifyPage() {
  return (
    <main id="main-content" className="w-full min-w-0">
      <VerifyReceipt />
    </main>
  );
}
