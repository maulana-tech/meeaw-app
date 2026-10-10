# Concepts

A few core ideas that make Meaw tick, explained plainly.

## Private notes (the shielded pool)

Instead of paying money *to your address*, Meaw payments go into a shared
**shielded pool** — think of it as a big communal vault. Your payment becomes a
**private note** inside that vault: a sealed record that says "this much money
belongs to whoever holds the right key."

* The vault publicly shows only that *a note was added* — never who it's for or
  how much (until it's withdrawn).
* You discover your notes by scanning the vault and unlocking the ones meant for
  you.
* When you spend, you prove you own a valid note *without pointing to which one*.

This is what makes deposits and withdrawals **unlinkable** — the vault mixes
everyone's notes together, and the math keeps yours private.

## Unlinkability

The single most important idea in Meaw: **an observer can't connect the money
coming in to the money going out.** They can see deposits happen and withdrawals
happen, but not that a particular deposit funded a particular withdrawal, or that
either one is yours.

## Self-custody & passkeys

Meaw is **self-custodial** — you hold the keys that authorize spending, not us.
The app and its servers can't spend your money. The pool admin can pause
deposits and withdrawals during an emergency; it cannot move funds or change the
proof rules, which are fixed when the pool is deployed.

Instead of a seed phrase, you sign in with Google, email or a **passkey**, which
gives you a Privy embedded wallet on Monad, plus a **6-digit PIN** that protects
the keys for your private notes.
No 24-word phrase to lose down the back of the couch.

The trade-off of self-custody: recovery is on you. That's what the PIN is for —
keep it safe. See [Security & Recovery](security.md).

## Selective disclosure

Privacy by default doesn't mean you can never prove anything. **Selective
disclosure** lets you voluntarily prove that one specific payment happened — for
your accountant, the tax office, or your bank — without revealing your other
payments. Private by default, provable by choice.

## Cashing out to a bank

The Monad version withdraws to any Monad wallet. A bank off-ramp is not wired up
yet; when one is added, bank details will go directly to the regulated provider,
never through Meaw.
