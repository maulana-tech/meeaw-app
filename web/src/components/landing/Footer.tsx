import Image from "next/image";
import { Frame } from "./primitives";

const COLUMNS: {
  title: string;
  links: { label: string; href: string }[];
}[] = [
  {
    title: "Product",
    links: [
      { label: "Why Mawee", href: "#why" },
      { label: "How it works", href: "#how" },
      { label: "Who it's for", href: "#who" },
      { label: "FAQ", href: "#faq" },
    ],
  },
  {
    title: "Resources",
    links: [
      {
        label: "Docs",
        href: "https://amelias-organization-20.gitbook.io/mawee/",
      },
      { label: "Privacy policy", href: "/privacy" },
    ],
  },
  {
    title: "Community",
    links: [
      { label: "X (Twitter)", href: "https://x.com/maweexyz" },
      { label: "Discord", href: "https://discord.gg/mawee" },
    ],
  },
];

export function Footer() {
  return (
    <footer className="bg-void text-starlight">
      <Frame className="grid gap-12 py-16 lg:grid-cols-[1.4fr_2fr]">
        <div>
          <a
            href="#top"
            className="inline-flex items-center gap-2.5 text-starlight hover:text-starlight"
            aria-label="Mawee home"
          >
            <Image src="/assets/mawee.svg" alt="" width={28} height={28} />
            <span className="text-xl font-medium tracking-tight">Mawee</span>
          </a>
          <p className="mt-4 max-w-[36ch] text-sm leading-relaxed text-starlight/55">
            Private USDC payment links on Monad. Private by default, provable on
            demand.
          </p>
        </div>
        <nav
          aria-label="Footer"
          className="grid grid-cols-2 gap-10 sm:grid-cols-3"
        >
          {COLUMNS.map((column) => (
            <div key={column.title}>
              <h2 className="text-sm text-starlight/50">{column.title}</h2>
              <ul className="mt-4 grid list-none gap-3">
                {column.links.map((link) => {
                  const external = link.href.startsWith("http");
                  return (
                    <li key={link.label}>
                      <a
                        href={link.href}
                        target={external ? "_blank" : undefined}
                        rel={external ? "noreferrer" : undefined}
                        className="text-[15px] text-starlight/85 transition-colors hover:text-starlight"
                      >
                        {link.label}
                      </a>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>
      </Frame>
      <Frame className="flex flex-wrap items-center justify-between gap-3 border-t border-starlight/10 py-6 text-xs text-starlight/45">
        <a href="/privacy" className="hover:text-starlight/80">
          Privacy policy
        </a>
        <span>© {new Date().getFullYear()} Mawee. All rights reserved.</span>
      </Frame>
    </footer>
  );
}
