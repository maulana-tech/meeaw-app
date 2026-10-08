import { commitment, ownerPk } from "../../lib/crypto";
import type { LocalAccount, MyNote, ScanResult } from "../../lib/notes";
import { accountForGeneration, accountForNote } from "./keyRing";
import { getPrivacyKeyring } from "./session";
import type { LocalPrivacyKeyring } from "./types";

export type GenerationProofContext = {
  keyring?: LocalPrivacyKeyring;
  fundingGeneration?: number;
  isCurrent?: () => boolean;
};
export function fundingAccount(
  context: GenerationProofContext & { account: LocalAccount },
): LocalAccount {
  if (context.isCurrent && !context.isCurrent())
    throw new Error(
      "The privacy key session changed. Review this payment again.",
    );
  if (!context.keyring) {
    if (
      (context.fundingGeneration ?? 0) !== 0 ||
      (getPrivacyKeyring()?.accounts.size ?? 0) > 1
    )
      throw new Error(
        "Captured privacy key history is required for this payment.",
      );
    return context.account;
  }
  if (
    context.fundingGeneration === undefined &&
    context.keyring.accounts.size !== 1
  )
    throw new Error("A captured funding generation is required.");
  return accountForGeneration(context.keyring, context.fundingGeneration ?? 0);
}
export async function noteProofAccount(
  context: GenerationProofContext & { account: LocalAccount; scan: ScanResult },
  note: MyNote,
  migration = false,
): Promise<LocalAccount> {
  fundingAccount(context);
  const generation = note.keyGeneration ?? 0,
    target = context.fundingGeneration ?? 0;
  if (!migration && generation !== target)
    throw new Error(
      "Prepare this historical balance for the captured funding key first.",
    );
  const account = context.keyring
    ? accountForNote(context.keyring, note)
    : context.account;
  if (!context.keyring && generation !== 0)
    throw new Error("Historical privacy key context is missing.");
  if (
    note.scope !== context.scan.scope ||
    context.scan.leaves[note.leafIndex] !==
      (await commitment(
        note.amount,
        await ownerPk(account.ownerSecret),
        note.salt,
      ))
  )
    throw new Error(
      "This note does not match its owning privacy key and pool leaf.",
    );
  return account;
}
