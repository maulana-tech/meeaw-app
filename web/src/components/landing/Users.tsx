import type { LucideIcon } from "lucide-react";
import {
  Briefcase,
  Building2,
  Globe2,
  PenTool,
  Store,
  Users as UsersIcon,
} from "lucide-react";
import { Frame, MonoLabel } from "./primitives";

const AUDIENCES: { icon: LucideIcon; title: string; body: string }[] = [
  {
    icon: PenTool,
    title: "Freelancers",
    body: "Invoice international clients without exposing your rates.",
  },
  {
    icon: UsersIcon,
    title: "Creators",
    body: "Accept tips and sales without publishing your revenue.",
  },
  {
    icon: Building2,
    title: "Agencies",
    body: "Bill clients without revealing who else you work with.",
  },
  {
    icon: Store,
    title: "Online stores",
    body: "Take stablecoin payments and keep your books to yourself.",
  },
  {
    icon: Globe2,
    title: "Remote teams",
    body: "Get paid across borders in minutes, not days.",
  },
  {
    icon: Briefcase,
    title: "Consultants",
    body: "Send fixed-price payment links for each engagement.",
  },
];

export function Users() {
  return (
    <section
      id="who"
      data-ed-section
      aria-labelledby="who-title"
      className="relative bg-mist pb-24 text-graphite sm:pb-32"
    >
      <Frame>
        <div className="grid gap-6 border-t border-graphite/10 pt-24 sm:pt-28 lg:grid-cols-[1fr_1fr]">
          <div>
            <MonoLabel className="text-graphite/60">
              {"/// Who it's for"}
            </MonoLabel>
            <h2
              id="who-title"
              className="mt-4 text-[clamp(1.9rem,3vw,2.8rem)] font-light tracking-tight"
            >
              Built for people who get paid online
            </h2>
          </div>
          <p className="max-w-[48ch] self-end text-lg leading-relaxed text-graphite/75">
            If your invoices land on a public blockchain, so does your business.
            Mawee gives you the speed of{" "}
            <span className="text-nebula font-medium">stablecoin payments</span>{" "}
            without turning your income into public data.
          </p>
        </div>
        <ul className="mt-16 grid list-none gap-x-10 gap-y-14 sm:grid-cols-2 lg:grid-cols-3">
          {AUDIENCES.map(({ icon: Icon, title, body }) => (
            <li key={title} data-ed-article>
              <span
                aria-hidden="true"
                className="flex size-10 items-center justify-center rounded-full border border-violet/60 text-violet"
              >
                <Icon className="size-[18px]" strokeWidth={1.6} />
              </span>
              <h3 className="mt-6 text-xl font-normal tracking-tight">
                {title}
              </h3>
              <p className="mt-2 max-w-[34ch] text-[15px] leading-relaxed text-graphite/65">
                {body}
              </p>
            </li>
          ))}
        </ul>
      </Frame>
    </section>
  );
}
