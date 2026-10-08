# Routine privacy-key rotation

In Settings, choose **Rotate privacy key**, authenticate with your existing PIN or
passkey, review the next key version, then confirm the wallet signatures. A wallet
transaction is also required when gas is not sponsored. New incoming payments use
the new key after registry confirmation. No private funds move during rotation.

The same recovery root derives all retained generations. Generation zero preserves
the original derivation; later generations use separate derivation domains. Public
history contains public key pairs and canonical chain evidence, never a recovery
root, owner secret, or viewing secret. The first release retains up to 64 versions.
Routine rotation does not revoke old keys or repair a compromised recovery root.

## Recovery and pending work

Unlocking restores the entire verified history. Old notes, late payments to old
requests, outgoing records, cash-outs, and receipt exports select the key that
matches their original immutable identity. Closing the dialog preserves accepted
work; reopen Settings and check status. If the private session was cleared, use
**Unlock updated keys** with the same recovery.

Server admission prevents rotation from overlapping admitted sends, request
payments, cash-outs, or PIN changes across devices and pools. Existing unsigned
reservations can be abandoned only before dispatch. Submitted or uncertain work is
retained until chain evidence resolves it; a timeout alone never releases it.
A cash-out retry resumes the same note operation. Before another rotation, the
server repairs lost completion responses using confirmed canonical spent evidence.
If a wallet/send response is uncertain, finish or retry that cash-out first.

Mixed-generation funding prepares only the required deficit using existing private
split transactions, then merges notes under one funding key. This preparation is
part of a payment, never part of rotation, and preserves source change and pool
scope. Legacy encrypted recovery records remain readable.

## Validation and operations

Tests cover isolated Mongo admission races, lost responses, stale private sessions,
PIN/passkey continuity, registry authorization and confirmation, historical note
recovery, and mixed-generation proofs. Local contract tests check unchanged pool
root/balance during rotation and a 15 + 5 payment with another pool untouched.
Controlled browser fixtures verify layout without wallet or chain writes.

Apply the additive `20261008160000-privacy-key-generations.js` migration through the
normal deployment process. No live key rotation, production migration, or contract
deployment is implied by these local tests. Chain reads and relayer configuration
must be available for activation and reconciliation.
