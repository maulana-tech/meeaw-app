# FAQs

## Is Meaw anonymous?

Not exactly — it's **private**, which is a bit different. Meaw hides the link
between who paid you and the money you take out, so people can't build a profile
of your income and clients. But when you cash out, the amount and destination are
visible on-chain. Think "your business stays your business," not "invisible."

## Do I need crypto experience to use it?

Nope. If you can sign in with your fingerprint and share a link, you can use Meaw.
Start with [The Basics, No Jargon](new-to-crypto.md).

## Do I need to buy a "gas" token for fees?

No. Meaw covers the network fees for you. You don't need to hold any special
token just to get paid or cash out.

## What is USDC?

A digital dollar — a stablecoin worth ~$1. It's what you get paid in, so the
value doesn't swing around like other crypto.

## What does my client need to pay?

Any EVM wallet (MetaMask, Rabby, …) holding USDC on Monad. They only sign —
Meaw covers the network fee. Paying from other chains is not supported yet.

## Do I need to hold USDC to receive money?

No. Receiving needs nothing but your Meaw account, and Meaw covers the
network fees when you withdraw.

## What's the PIN for?

It's your backup and recovery key, and it unlocks spending. Keep it safe and
private.

## Will Meaw ever ask for my PIN?

**Never.** Not by email, DM, or "support." Only ever type your PIN into the Meaw
app itself. Anyone asking for it is a scammer.

## What if I lose my device?

Your 6-digit PIN backs account recovery. This is why keeping it safe matters — in
a self-custodial system, recovery depends on you, not on us being able to reset
things for you.

## Can Meaw freeze or take my money?

The app and its servers can't spend or take your funds. Your spending authority
stays with your wallet and PIN, while funds sit in an on-chain pool rather than
a Meaw server account.

For incident response, the pool admin can pause deposits, transfers, and
withdrawals. The contract has no upgrade path and no way for the admin to move
funds; the proof verifiers are fixed at deployment.

## How do I cash out to my bank?

Not yet on Monad. Today you withdraw USDC to any Monad wallet, and from there to
an exchange or off-ramp of your choice.

## Can I prove a payment for taxes or accounting?

Yes — selective disclosure lets you prove one specific payment happened without
revealing your other payments. See
[Practical Privacy](practical-privacy.md#traceability-on-your-terms).

## Is Meaw safe to use with real money right now?

Not yet. Meaw is on testnet with play money and hasn't been independently audited.
It's a preview. Don't put real funds in until launch. See
[Security & Recovery](security.md).

## Is this legal / is it a tool for hiding money?

Meaw is built for everyday financial privacy — the same reason you use an envelope
instead of a postcard. It's not a mixer, and it supports proving payments when you
need to. Practical privacy, not illicit activity.
