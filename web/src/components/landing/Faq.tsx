"use client";

import { useState } from "react";
import { Frame, MonoLabel } from "./primitives";

const FAQ_ITEMS = [
  {
    question: "Do my clients need to use Mawee?",
    answer:
      "No. They open your link and pay in USDC from the wallet they already use, like MetaMask. They only sign — Mawee covers the network fee.",
  },
  {
    question: "What stays private?",
    answer:
      "Who paid you, how much you've earned, and your payment history. Each payment becomes an encrypted note that only your keys can read. Two things stay visible on-chain: that a payment entered the pool, and the amount and destination when you withdraw.",
  },
  {
    question: "Can I still prove I received a payment?",
    answer:
      "Yes. Export a receipt for any single payment. It proves that payment happened — for your accountant, bank, auditor, or tax office — without revealing any of your other payments.",
  },
  {
    question: "What happens if I lose my phone or laptop?",
    answer:
      "Sign in on a new device. If you chose a passkey, unlock with the same passkey (synced by iCloud Keychain, Google Password Manager, or 1Password) and your balance reappears. If you chose a PIN, enter your PIN.",
  },
  {
    question: "How is Mawee different from a crypto mixer?",
    answer:
      "Mixers hide where money came from with no practical way to prove a single transaction. Mawee is built for business: routine payments stay private, and you can prove any specific payment whenever you need to.",
  },
  {
    question: "Why not just use a new wallet for every payment?",
    answer:
      "It gets unmanageable fast, and moving funds between those wallets still reveals the pattern on a public blockchain. Mawee gives you one link and one balance, with privacy built in.",
  },
  {
    question: "Why Monad?",
    answer:
      "Monad is fully EVM-compatible with sub-second finality and low fees, so a private payment settles almost instantly and the zero-knowledge proof checks stay cheap enough for everyday payments.",
  },
] as const;

export function Faq() {
  const [openItems, setOpenItems] = useState<Set<string>>(() => new Set());

  const toggleItem = (question: string) => {
    setOpenItems((current) => {
      const next = new Set(current);
      if (next.has(question)) next.delete(question);
      else next.add(question);
      return next;
    });
  };

  return (
    <section
      id="faq"
      data-ed-section
      aria-labelledby="faq-title"
      className="relative py-24 sm:py-32"
    >
      <Frame>
        <div className="grid gap-12 lg:grid-cols-[1fr_2fr]">
          <div>
            <MonoLabel className="text-starlight/60">FAQ</MonoLabel>
            <h2
              id="faq-title"
              className="mt-4 text-[clamp(1.9rem,2.8vw,2.6rem)] font-normal tracking-tight"
            >
              Questions, answered
            </h2>
            <p className="mt-4 max-w-[34ch] text-[15px] leading-relaxed text-starlight/60">
              Privacy should feel practical, not mysterious. These come up
              first.
            </p>
          </div>

          <div className="border-t border-starlight/10">
            {FAQ_ITEMS.map((item) => {
              const isOpen = openItems.has(item.question);
              const answerId = `faq-answer-${item.question
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, "-")}`;

              return (
                <div
                  className="group border-b border-starlight/10"
                  data-open={isOpen}
                  key={item.question}
                >
                  <button
                    type="button"
                    className="flex min-h-[72px] w-full cursor-pointer items-center justify-between gap-6 py-5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet"
                    aria-expanded={isOpen}
                    aria-controls={answerId}
                    onClick={() => toggleItem(item.question)}
                  >
                    <span className="text-lg font-normal tracking-tight text-starlight sm:text-xl">
                      {item.question}
                    </span>
                    <span
                      className="relative grid size-10 shrink-0 place-items-center rounded-full border border-starlight/25 text-starlight transition-colors group-data-[open=true]:border-violet group-data-[open=true]:bg-violet"
                      aria-hidden="true"
                    >
                      <span className="absolute h-px w-4 bg-current" />
                      <span className="absolute h-4 w-px bg-current transition-[opacity,transform] duration-200 group-data-[open=true]:rotate-90 group-data-[open=true]:opacity-0" />
                    </span>
                  </button>
                  <div
                    aria-hidden={!isOpen}
                    className="grid grid-rows-[0fr] opacity-0 transition-[grid-template-rows,opacity] duration-300 ease-out data-[open=true]:grid-rows-[1fr] data-[open=true]:opacity-100 motion-reduce:transition-none"
                    data-open={isOpen}
                    id={answerId}
                  >
                    <div className="min-h-0 overflow-hidden">
                      <p className="max-w-[68ch] pb-7 pr-14 text-[15px] leading-relaxed text-starlight/65">
                        {item.answer}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </Frame>
    </section>
  );
}
