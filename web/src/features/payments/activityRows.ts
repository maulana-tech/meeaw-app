import { fromBaseUnits } from "../../lib/crypto";
import type { ActivityInput, ActivityRow } from "./activityTypes";
export function buildActivityRows(
  input: ActivityInput,
): readonly ActivityRow[] {
  const rows: ActivityRow[] = [],
    consumed = new Set<string>(),
    txs = new Set<string>(),
    senderTxs = new Set<string>();
  const leaf = (scope: string, index: number) => `${scope}:${index}`;
  const ownNfs = new Map(
    input.notes.flatMap((n) =>
      n.nullifierHex
        ? [[`${n.scope}:${n.nullifierHex.toLowerCase()}`, n] as const]
        : [],
    ),
  );
  for (const r of input.transfers) {
    const sent = r.sender.wallet.toLowerCase() === input.viewer.toLowerCase(),
      payload = input.payloads.get(r.id);
    if (
      !sent &&
      r.recipient.wallet.toLowerCase() !== input.viewer.toLowerCase()
    )
      continue;
    if (r.receipt) {
      txs.add(`${r.pool}:${r.receipt.txHash.toLowerCase()}`);
      if (sent) senderTxs.add(`${r.pool}:${r.receipt.txHash.toLowerCase()}`);
      consumed.add(leaf(r.pool, r.receipt.leafIndex));
    }
    rows.push({
      id: `transfer:${r.id}:${sent ? "sent" : "received"}`,
      scope: r.pool,
      kind: r.status === "confirmed" ? (sent ? "sent" : "received") : "attempt",
      status: r.status,
      amount: payload ? BigInt(payload.amount) : null,
      note: payload?.note ?? null,
      counterparty: sent ? r.recipient.username : r.sender.username,
      at: r.receipt?.confirmedAt ?? r.createdAt,
      txHash: r.receipt?.txHash ?? null,
      leafIndex: !sent ? (r.receipt?.leafIndex ?? null) : null,
      locked: !payload,
      transferId: r.id,
    });
  }
  for (const e of input.evidence) {
    const owned = e.inputs
      .map((n) => ownNfs.get(`${e.scope}:${n.toLowerCase()}`))
      .filter((n) => n !== undefined);
    const outputs = e.outputs
      .map((o) =>
        input.notes.find(
          (n) => n.scope === e.scope && n.leafIndex === o.leafIndex,
        ),
      )
      .filter((n) => n !== undefined);
    if (
      e.kind === "merge" ||
      e.kind === "split" ||
      (e.kind === "transfer" &&
        (owned.length > 0 ||
          senderTxs.has(`${e.scope}:${e.txHash.toLowerCase()}`)))
    )
      for (const o of e.outputs) consumed.add(leaf(e.scope, o.leafIndex));
    if (!owned.length) continue;
    if (e.kind === "withdraw" && e.withdrawAmount !== null) {
      rows.push({
        id: `withdraw:${e.scope}:${e.txHash}`,
        scope: e.scope,
        kind: "cashedOut",
        status: "confirmed",
        amount: BigInt(e.withdrawAmount),
        note: null,
        counterparty: null,
        at: e.at,
        txHash: e.txHash,
        leafIndex: null,
        locked: false,
        transferId: null,
      });
    } else if (
      e.kind === "transfer" &&
      !txs.has(`${e.scope}:${e.txHash.toLowerCase()}`)
    ) {
      const amount =
        owned.reduce((sum, n) => sum + n.amount, 0n) -
        outputs.reduce((sum, n) => sum + n.amount, 0n);
      if (amount > 0n)
        rows.push({
          id: `send:${e.scope}:${e.txHash}`,
          scope: e.scope,
          kind: "sent",
          status: "confirmed",
          amount,
          note: null,
          counterparty: null,
          at: e.at,
          txHash: e.txHash,
          leafIndex: null,
          locked: false,
          transferId: null,
        });
    }
  }
  for (const n of input.notes) {
    if (n.internal) continue;
    if (n.amount <= 0n || consumed.has(leaf(n.scope, n.leafIndex))) continue;
    const evidence = input.evidence.find(
      (e) =>
        e.scope === n.scope &&
        e.outputs.some((o) => o.leafIndex === n.leafIndex),
    );
    if (evidence?.kind === "merge" || evidence?.kind === "split") continue;
    rows.push({
      id: `note:${n.scope}:${n.leafIndex}`,
      scope: n.scope,
      kind: evidence ? "received" : "unclassified",
      status: "confirmed",
      amount: n.amount,
      note: null,
      counterparty: null,
      at: evidence?.at ?? n.receivedAt ?? "",
      txHash: evidence?.txHash ?? null,
      leafIndex: n.leafIndex,
      locked: false,
      transferId: null,
    });
  }
  return rows.sort(
    (a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id),
  );
}
function csvText(value: string) {
  const safe = /^[\s]*[=+@-]/.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}
export function csvActivity(rows: readonly ActivityRow[]) {
  return (
    "type,status,amount_usdc,counterparty,note,confirmed_at,transaction\n" +
    rows
      .map((r) =>
        [
          r.kind,
          r.status,
          r.amount === null ? "" : fromBaseUnits(r.amount),
          csvText(r.counterparty ?? ""),
          csvText(r.note ?? ""),
          csvText(r.at),
          r.txHash ?? "",
        ].join(","),
      )
      .join("\n")
  );
}
