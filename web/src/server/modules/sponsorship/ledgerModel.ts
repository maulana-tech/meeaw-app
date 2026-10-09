import { createHash } from "node:crypto";
import { type Hex, keccak256 } from "viem";
import type {
  ActionIntent,
  ActionTicket,
  ChildTicket,
  FeeEvidence,
  FrozenTx,
  Principal,
  QuotaStatus,
  SponsorPolicy,
} from "../../../features/sponsorship/types";
import { accountedFee, maximumLiability } from "./fees";
import { SponsorshipError } from "./sponsorship.errors";
export type StoredTx = Omit<FrozenTx, "data" | "gas" | "fee" | "value"> & {
  value: "0";
  dataDigest: Hex;
  gas: string;
  fee:
    | { type: 0; gasPrice: string }
    | { type: 2; maxFeePerGas: string; maxPriorityFeePerGas: string };
};
export type LedgerChild = {
  id: string;
  fence: number;
  digest: Hex;
  tx: StoredTx;
  maximumWei: string;
  walletFence: number | null;
  phase:
    | "allocated"
    | "signing"
    | "signed"
    | "unknown"
    | "settled"
    | "abandoned";
  hash: Hex | null;
  paid?: {
    wei: string;
    day: string;
    block: string;
    blockHash: Hex;
    outcome: "confirmed" | "reverted";
    hash: Hex;
  };
};
export type LedgerAction = {
  intent: ActionIntent;
  fence: number;
  policy: SponsorPolicyStored;
  remainingWei: string;
  charged: boolean;
  chargedDay: string | null;
  legacy: boolean;
  phase: "active" | "paused" | "closed" | "cancelled";
  children: Record<string, LedgerChild>;
};
export type SponsorPolicyStored = Omit<
  SponsorPolicy,
  | "globalWei"
  | "anonymousWei"
  | "actionWei"
  | "balanceFloorWei"
  | "feeCeilingWei"
> & {
  globalWei: string;
  anonymousWei: string;
  actionWei: string;
  balanceFloorWei: string;
  feeCeilingWei: string;
};
export type LedgerSnapshot = {
  _id: string;
  chainId: number;
  revision: number;
  nextFence: number;
  day: string;
  serverNow: Date;
  usedWeiStr: string;
  anonymousUsedWeiStr: string;
  reservedWeiStr: string;
  anonymousReservedWeiStr: string;
  counters: Record<string, number>;
  actions: Record<string, LedgerAction>;
  policy: SponsorPolicyStored | null;
  bootstrap: { state: "initializing" | "complete"; cursor: string | null };
  recoveryCursor?: string | null;
};
export type SponsorCommand =
  | { kind: "recovery-cursor"; cursor: string | null }
  | {
      kind: "retire";
      ticket: ChildTicket;
      retiredWalletFence: number;
      hash: Hex;
    }
  | {
      kind: "import";
      intent: ActionIntent;
      tx: FrozenTx;
      digest: Hex;
      hash: Hex;
      walletFence: number;
    }
  | {
      kind: "baseline";
      expectedCursor: string | null;
      cursor: string | null;
      complete: boolean;
    }
  | { kind: "admit"; intent: ActionIntent }
  | {
      kind: "allocate";
      ticket: ActionTicket;
      childId: string;
      digest: Hex;
      tx: FrozenTx;
    }
  | { kind: "signing"; ticket: ChildTicket; walletFence: number }
  | { kind: "pin"; ticket: ChildTicket; hash: Hex }
  | { kind: "broadcast"; ticket: ChildTicket; hash: Hex }
  | { kind: "settle"; ticket: ChildTicket; evidence: FeeEvidence }
  | { kind: "release"; ticket: ChildTicket; retiredWalletFence: number }
  | { kind: "close" | "cancel" | "pause" | "resume"; ticket: ActionTicket }
  | { kind: "status"; principal: Principal };
const hash = /^0x[0-9a-fA-F]{64}$/;
export const ledgerKey = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const pkey = (p: Principal) =>
  p.kind === "anonymous" ? "anonymous" : ledgerKey(`${p.kind}:${p.key}`);
const anon = (p: Principal) => p.kind !== "user";
const live = (a: LedgerAction) => a.phase === "active" || a.phase === "paused";
const dayOf = (date: Date) => date.toISOString().slice(0, 10);
const error = (reason: NonNullable<QuotaStatus["reason"]>): never => {
  throw new SponsorshipError(reason);
};
export function storePolicy(p: SponsorPolicy): SponsorPolicyStored {
  return {
    ...p,
    globalWei: p.globalWei.toString(),
    anonymousWei: p.anonymousWei.toString(),
    actionWei: p.actionWei.toString(),
    balanceFloorWei: p.balanceFloorWei.toString(),
    feeCeilingWei: p.feeCeilingWei.toString(),
  };
}
export function restorePolicy(p: SponsorPolicyStored): SponsorPolicy {
  return {
    ...p,
    globalWei: BigInt(p.globalWei),
    anonymousWei: BigInt(p.anonymousWei),
    actionWei: BigInt(p.actionWei),
    balanceFloorWei: BigInt(p.balanceFloorWei),
    feeCeilingWei: BigInt(p.feeCeilingWei),
  };
}
export function emptyLedger(
  chainId: number,
  now: Date,
  bootstrapState: "initializing" | "complete",
): LedgerSnapshot {
  return {
    _id: `chain:${chainId}`,
    chainId,
    revision: 0,
    nextFence: 0,
    day: dayOf(now),
    serverNow: now,
    usedWeiStr: "0",
    anonymousUsedWeiStr: "0",
    reservedWeiStr: "0",
    anonymousReservedWeiStr: "0",
    counters: {},
    actions: {},
    policy: null,
    bootstrap: { state: bootstrapState, cursor: null },
  };
}
function storeTx(tx: FrozenTx): StoredTx {
  maximumLiability(tx);
  const { data, gas, fee, value, ...fields } = tx;
  void value;
  return {
    ...fields,
    value: "0",
    dataDigest: keccak256(data),
    gas: gas.toString(),
    fee:
      fee.type === 0
        ? { type: 0, gasPrice: fee.gasPrice.toString() }
        : {
            type: 2,
            maxFeePerGas: fee.maxFeePerGas.toString(),
            maxPriorityFeePerGas: fee.maxPriorityFeePerGas.toString(),
          },
  };
}
function totals(s: LedgerSnapshot) {
  let held = 0n,
    guest = 0n;
  for (const a of Object.values(s.actions)) {
    held += BigInt(a.remainingWei);
    if (anon(a.intent.principal)) guest += BigInt(a.remainingWei);
  }
  s.reservedWeiStr = held.toString();
  s.anonymousReservedWeiStr = guest.toString();
}
function reserved(s: LedgerSnapshot, key: string) {
  return Object.values(s.actions).filter(
    (a) =>
      live(a) &&
      !a.charged &&
      !a.legacy &&
      (key === "anonymous"
        ? anon(a.intent.principal)
        : pkey(a.intent.principal) === key),
  ).length;
}
function counterLimit(p: Principal, policy: SponsorPolicy) {
  return p.kind === "user"
    ? policy.userLimit
    : p.kind === "guest-wallet"
      ? policy.guestWalletLimit
      : policy.anonymousLimit;
}
function quota(s: LedgerSnapshot, p: Principal, policy: SponsorPolicy) {
  const key = pkey(p);
  return {
    used: s.counters[key] ?? 0,
    reserved: reserved(s, key),
    limit: counterLimit(p, policy),
  };
}
function status(
  s: LedgerSnapshot,
  p: Principal,
  policy: SponsorPolicy,
): QuotaStatus {
  const q = quota(s, p, policy);
  let reason: QuotaStatus["reason"] = null;
  if (s.bootstrap.state !== "complete") reason = "initializing";
  else if (q.used + q.reserved >= q.limit) reason = "quota";
  else if (
    BigInt(s.usedWeiStr) + BigInt(s.reservedWeiStr) + policy.actionWei >
    policy.globalWei
  )
    reason = "budget";
  else if (
    anon(p) &&
    ((s.counters.anonymous ?? 0) + reserved(s, "anonymous") >=
      policy.anonymousLimit ||
      BigInt(s.anonymousUsedWeiStr) +
        BigInt(s.anonymousReservedWeiStr) +
        policy.actionWei >
        policy.anonymousWei)
  )
    reason = "anonymous-budget";
  return {
    configured: true,
    available: reason === null,
    reason,
    limit: q.limit,
    used: q.used,
    reserved: q.reserved,
    remaining: Math.max(0, q.limit - q.used - q.reserved),
    resetAt: new Date(
      new Date(`${s.day}T00:00:00Z`).getTime() + 86_400_000,
    ).toISOString(),
  };
}
function action(s: LedgerSnapshot, t: ActionTicket) {
  const a = s.actions[ledgerKey(t.actionId)];
  if (t.chainId !== s.chainId || !a || a.fence !== t.fence) error("budget");
  return a;
}
function child(s: LedgerSnapshot, t: ChildTicket) {
  const a = action(s, t),
    c = a.children[ledgerKey(t.childId)];
  if (!c || c.fence !== t.childFence) error("budget");
  return { a, c };
}
function validIntent(
  i: ActionIntent,
  policy: SponsorPolicy,
  s: LedgerSnapshot,
) {
  if (
    i.chainId !== s.chainId ||
    !i.actionId ||
    i.actionId.length > 200 ||
    !hash.test(i.businessDigest) ||
    ![
      "register",
      "rotation",
      "deposit",
      "withdraw",
      "withdraw-batch",
      "legacy-transfer",
      "send",
      "request-pay",
      "faucet",
    ].includes(i.kind) ||
    !["user", "guest-wallet", "anonymous"].includes(i.principal.kind) ||
    !i.principal.key ||
    i.principal.key.length > 256 ||
    !Number.isInteger(i.maximumChildren) ||
    i.maximumChildren < 1 ||
    i.maximumChildren > policy.maxChildren
  )
    error("cost");
}
export function sameActionIntent(a: ActionIntent, b: ActionIntent): boolean {
  return (
    a.chainId === b.chainId &&
    a.actionId === b.actionId &&
    a.kind === b.kind &&
    a.principal.kind === b.principal.kind &&
    a.principal.key === b.principal.key &&
    a.businessDigest.toLowerCase() === b.businessDigest.toLowerCase() &&
    a.maximumChildren === b.maximumChildren
  );
}
export function reduceSponsorCommand(
  current: LedgerSnapshot,
  cmd: SponsorCommand,
  policy: SponsorPolicy,
  now: Date,
): {
  state: LedgerSnapshot;
  result: ActionTicket | ChildTicket | QuotaStatus | undefined;
} {
  const s = structuredClone(current),
    day = dayOf(now);
  if (day < s.day) error("rpc");
  if (day !== s.day) {
    s.day = day;
    s.usedWeiStr = "0";
    s.anonymousUsedWeiStr = "0";
    s.counters = {};
  }
  s.policy = storePolicy(policy);
  totals(s);
  let result: ActionTicket | ChildTicket | QuotaStatus | undefined;
  if (cmd.kind === "status") result = status(s, cmd.principal, policy);
  else if (cmd.kind === "recovery-cursor") s.recoveryCursor = cmd.cursor;
  else if (cmd.kind === "baseline") {
    if (
      s.bootstrap.cursor !== cmd.expectedCursor ||
      s.bootstrap.state === "complete"
    )
      error("rpc");
    s.bootstrap = {
      state: cmd.complete ? "complete" : "initializing",
      cursor: cmd.cursor,
    };
  } else if (cmd.kind === "import") {
    const i = cmd.intent,
      tx = storeTx(cmd.tx),
      key = ledgerKey(i.actionId),
      prior = s.actions[key];
    if (
      i.chainId !== s.chainId ||
      cmd.tx.chainId !== s.chainId ||
      !hash.test(cmd.hash) ||
      !hash.test(cmd.digest) ||
      !Number.isSafeInteger(cmd.walletFence) ||
      cmd.walletFence < 1
    )
      error("cost");
    if (prior) {
      const c = prior.children[ledgerKey("legacy")];
      if (
        !prior.legacy ||
        !sameActionIntent(prior.intent, i) ||
        !c ||
        c.hash !== cmd.hash ||
        JSON.stringify(c.tx) !== JSON.stringify(tx)
      )
        error("cost");
      result = {
        chainId: s.chainId,
        actionId: i.actionId,
        fence: prior.fence,
        childId: "legacy",
        childFence: c.fence,
      };
    } else {
      if (Object.keys(s.actions).length >= 256) error("capacity");
      const maximum = maximumLiability(cmd.tx),
        fence = ++s.nextFence,
        childFence = ++s.nextFence;
      s.actions[key] = {
        intent: structuredClone(i),
        fence,
        policy: storePolicy({ ...policy, actionWei: maximum }),
        remainingWei: maximum.toString(),
        charged: false,
        chargedDay: null,
        legacy: true,
        phase: "active",
        children: {
          [ledgerKey("legacy")]: {
            id: "legacy",
            fence: childFence,
            digest: cmd.digest,
            tx,
            maximumWei: maximum.toString(),
            walletFence: cmd.walletFence,
            phase: "signed",
            hash: cmd.hash,
          },
        },
      };
      result = {
        chainId: s.chainId,
        actionId: i.actionId,
        fence,
        childId: "legacy",
        childFence,
      };
    }
  } else if (cmd.kind === "admit") {
    const i = cmd.intent;
    validIntent(i, policy, s);
    const key = ledgerKey(i.actionId),
      prior = s.actions[key];
    const sibling =
      i.kind === "withdraw" || i.kind === "legacy-transfer"
        ? Object.values(s.actions).find(
            (a) =>
              !a.legacy &&
              live(a) &&
              a.intent.kind === i.kind &&
              a.intent.businessDigest === i.businessDigest,
          )
        : undefined;
    if (!prior && sibling) {
      if (
        sibling.intent.principal.kind !== i.principal.kind ||
        sibling.intent.principal.key !== i.principal.key
      )
        error("budget");
      result = {
        chainId: s.chainId,
        actionId: sibling.intent.actionId,
        fence: sibling.fence,
      };
    } else if (prior) {
      if (!sameActionIntent(prior.intent, i) || prior.phase === "cancelled")
        error("budget");
      result = { chainId: s.chainId, actionId: i.actionId, fence: prior.fence };
    } else {
      const availability = status(s, i.principal, policy);
      if (availability.reason) error(availability.reason);
      const keys = [
        pkey(i.principal),
        ...(anon(i.principal) ? ["anonymous"] : []),
      ];
      const missing = keys.filter((k) => !(k in s.counters));
      if (
        Object.keys(s.actions).length >= 256 ||
        Object.keys(s.counters).length + new Set(missing).size > 4096
      )
        error("capacity");
      for (const k of keys) s.counters[k] ??= 0;
      const a: LedgerAction = {
        intent: structuredClone(i),
        fence: ++s.nextFence,
        policy: storePolicy(policy),
        remainingWei: policy.actionWei.toString(),
        charged: false,
        chargedDay: null,
        legacy: false,
        phase: "active",
        children: {},
      };
      s.actions[key] = a;
      result = { chainId: s.chainId, actionId: i.actionId, fence: a.fence };
    }
  } else if (cmd.kind === "allocate") {
    const a = action(s, cmd.ticket);
    if (!live(a) || a.phase === "paused") error("budget");
    if (
      !cmd.childId ||
      cmd.childId.length > 200 ||
      !hash.test(cmd.digest) ||
      cmd.tx.chainId !== s.chainId
    )
      error("cost");
    const tx = storeTx(cmd.tx),
      key = ledgerKey(cmd.childId),
      previous = a.children[key];
    if (previous && previous.phase !== "abandoned") {
      if (
        previous.digest !== cmd.digest ||
        JSON.stringify(previous.tx) !== JSON.stringify(tx)
      )
        error("cost");
      result = {
        ...cmd.ticket,
        childId: cmd.childId,
        childFence: previous.fence,
      };
    } else {
      if (
        !previous &&
        Object.keys(a.children).length >= a.intent.maximumChildren
      )
        error("capacity");
      const maximum = maximumLiability(cmd.tx),
        cap =
          cmd.tx.fee.type === 0 ? cmd.tx.fee.gasPrice : cmd.tx.fee.maxFeePerGas;
      if (cap > policy.feeCeilingWei || cap > BigInt(a.policy.feeCeilingWei))
        error("cost");
      const allocated = Object.values(a.children)
        .filter((c) => c.phase !== "abandoned" && c.phase !== "settled")
        .reduce((sum, c) => sum + BigInt(c.maximumWei), 0n);
      if (maximum + allocated > BigInt(a.remainingWei)) error("cost");
      if (BigInt(s.usedWeiStr) + BigInt(s.reservedWeiStr) > policy.globalWei)
        error("budget");
      const c: LedgerChild = {
        id: cmd.childId,
        fence: ++s.nextFence,
        digest: cmd.digest,
        tx,
        maximumWei: maximum.toString(),
        walletFence: null,
        phase: "allocated",
        hash: null,
      };
      a.children[key] = c;
      result = { ...cmd.ticket, childId: cmd.childId, childFence: c.fence };
    }
  } else if (cmd.kind === "signing") {
    const { a, c } = child(s, cmd.ticket);
    if (
      !live(a) ||
      c.phase !== "allocated" ||
      !Number.isSafeInteger(cmd.walletFence) ||
      cmd.walletFence < 1
    )
      error("budget");
    if (BigInt(s.usedWeiStr) + BigInt(s.reservedWeiStr) > policy.globalWei)
      error("budget");
    if (
      anon(a.intent.principal) &&
      BigInt(s.anonymousUsedWeiStr) + BigInt(s.anonymousReservedWeiStr) >
        policy.anonymousWei
    )
      error("anonymous-budget");
    const signingPrice =
      c.tx.fee.type === 0 ? c.tx.fee.gasPrice : c.tx.fee.maxFeePerGas;
    if (BigInt(signingPrice) > policy.feeCeilingWei) error("cost");
    c.phase = "signing";
    c.walletFence = cmd.walletFence;
  } else if (cmd.kind === "pin") {
    const { a, c } = child(s, cmd.ticket);
    if (
      !live(a) ||
      !hash.test(cmd.hash) ||
      (c.phase !== "signing" && !(c.phase === "signed" && c.hash === cmd.hash))
    )
      error("budget");
    c.phase = "signed";
    c.hash = cmd.hash;
  } else if (cmd.kind === "broadcast") {
    const { c } = child(s, cmd.ticket);
    if (
      c.hash !== cmd.hash ||
      !["signed", "unknown", "settled"].includes(c.phase)
    )
      error("budget");
    if (c.phase !== "settled") c.phase = "unknown";
  } else if (cmd.kind === "retire") {
    const { c } = child(s, cmd.ticket);
    if (
      c.walletFence !== cmd.retiredWalletFence ||
      c.phase !== "signed" ||
      c.hash !== cmd.hash
    )
      error("budget");
    c.phase = "abandoned";
  } else if (cmd.kind === "release") {
    const { c } = child(s, cmd.ticket);
    if (
      (c.walletFence !== cmd.retiredWalletFence && c.walletFence !== null) ||
      !Number.isSafeInteger(cmd.retiredWalletFence) ||
      cmd.retiredWalletFence < 1 ||
      !["signing", "allocated"].includes(c.phase)
    )
      error("budget");
    c.phase = "abandoned";
  } else if (cmd.kind === "settle") {
    const { a, c } = child(s, cmd.ticket),
      e = cmd.evidence;
    if (
      c.hash !== e.hash ||
      JSON.stringify(storeTx(e.transaction)) !== JSON.stringify(c.tx) ||
      !hash.test(e.blockHash) ||
      e.block < 0n ||
      !["confirmed", "reverted"].includes(e.outcome)
    )
      error("cost");
    const fee = accountedFee(e.transaction, e),
      paidDay = dayOf(e.blockTime);
    if (paidDay > s.day || fee > BigInt(c.maximumWei)) error("cost");
    const paid = {
      wei: fee.toString(),
      day: paidDay,
      block: e.block.toString(),
      blockHash: e.blockHash,
      outcome: e.outcome,
      hash: e.hash,
    };
    if (c.phase === "settled") {
      if (JSON.stringify(c.paid) !== JSON.stringify(paid)) error("cost");
    } else {
      if (
        !["signed", "unknown"].includes(c.phase) ||
        fee > BigInt(a.remainingWei)
      )
        error("budget");
      c.phase = "settled";
      c.paid = paid;
      a.remainingWei = (BigInt(a.remainingWei) - fee).toString();
      if (paidDay === s.day) {
        s.usedWeiStr = (BigInt(s.usedWeiStr) + fee).toString();
        if (anon(a.intent.principal))
          s.anonymousUsedWeiStr = (
            BigInt(s.anonymousUsedWeiStr) + fee
          ).toString();
      }
      if (!a.charged) {
        a.charged = true;
        a.chargedDay = paidDay;
        if (!a.legacy && paidDay === s.day) {
          const key = pkey(a.intent.principal);
          s.counters[key] = (s.counters[key] ?? 0) + 1;
          if (anon(a.intent.principal) && key !== "anonymous")
            s.counters.anonymous = (s.counters.anonymous ?? 0) + 1;
        }
      }
    }
  } else {
    const a = action(s, cmd.ticket);
    if (cmd.kind === "pause") {
      if (!live(a)) error("budget");
      a.phase = "paused";
    } else if (cmd.kind === "resume") {
      if (!live(a)) error("budget");
      a.phase = "active";
    } else {
      if (
        Object.values(a.children).some((c) =>
          ["signing", "signed", "unknown"].includes(c.phase),
        )
      )
        error("budget");
      if (cmd.kind === "cancel" && a.charged) error("budget");
      for (const c of Object.values(a.children))
        if (c.phase === "allocated") c.phase = "abandoned";
      a.phase = cmd.kind === "cancel" ? "cancelled" : "closed";
      a.remainingWei = "0";
    }
  }
  totals(s);
  if (JSON.stringify(s).length > 8 * 1024 * 1024) error("capacity");
  return { state: s, result };
}
