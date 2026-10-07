import type { Metadata } from "next";
import { VerifyReceipt } from "../../components/receipts/VerifyReceipt";
export const metadata: Metadata = {
  title: "Verify a receipt | Mawee",
  description:
    "Check a shared Mawee note proof without uploading private details.",
};
export default function VerifyPage() {
  return (
    <main id="main-content" className="w-full min-w-0">
      <VerifyReceipt />
    </main>
  );
}
