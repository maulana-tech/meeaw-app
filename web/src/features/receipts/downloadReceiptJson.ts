import { canonicalReceiptJson, receiptIdentity } from "./receiptIdentity";
import type { ReceiptV2 } from "./receiptTypes";
export async function downloadReceiptJson(
  bundle: ReceiptV2,
  isCurrent: () => boolean = () => true,
): Promise<void> {
  const identity = await receiptIdentity(bundle);
  if (!isCurrent()) return;
  const url = URL.createObjectURL(
    new Blob([canonicalReceiptJson(bundle)], { type: "application/json" }),
  );
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = `mawee-receipt-${identity.reference.toLowerCase()}.json`;
    a.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}
