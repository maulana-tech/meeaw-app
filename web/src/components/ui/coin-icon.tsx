import Image from "next/image";
import { cn } from "@/lib/utils";

// A token's round logo; tokens without one show their first two letters.
export function CoinIcon({
  symbol,
  logo,
  className,
}: {
  symbol: string;
  logo?: string;
  className?: string;
}) {
  return logo ? (
    <Image
      src={logo}
      alt=""
      width={32}
      height={32}
      className={cn("size-6 shrink-0 rounded-full", className)}
    />
  ) : (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-6 shrink-0 items-center justify-center rounded-full border border-current/30 text-[9px] font-semibold",
        className,
      )}
    >
      {symbol.slice(0, 2)}
    </span>
  );
}
