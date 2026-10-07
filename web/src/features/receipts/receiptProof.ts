import { commitment, poseidonHash } from "../../lib/crypto";
import { receiptShapeValid, receiptWireSchema } from "./receiptSchema";
import type { ReceiptBundle } from "./receiptTypes";
export async function verifyReceiptMath(bundle: ReceiptBundle, depth = 20) {
  try {
    const parsed = receiptWireSchema.safeParse(bundle);
    if (!parsed.success)
      return { commitmentOk: false, rootOk: false, valid: false };
    const b = parsed.data;
    const comm = await commitment(
      BigInt(b.amount),
      BigInt(b.ownerPk),
      BigInt(b.salt),
    );
    const commitmentOk =
      comm === BigInt(b.commitment) && comm === BigInt(`0x${b.commitmentHex}`);
    let node = comm;
    for (let i = 0; i < depth; i++) {
      const sibling = BigInt(b.pathElements[i]);
      node =
        b.pathIndices[i] === 0
          ? await poseidonHash([node, sibling])
          : await poseidonHash([sibling, node]);
    }
    const rootOk =
      node === BigInt(b.root) && receiptShapeValid(b as ReceiptBundle, depth);
    return { commitmentOk, rootOk, valid: commitmentOk && rootOk };
  } catch {
    return { commitmentOk: false, rootOk: false, valid: false };
  }
}
