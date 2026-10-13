"use client";

import Link from "next/link";
import { use, useEffect, useRef, useState } from "react";
import { dashButtonPrimary } from "@/components/dashboard/styles";
import { MeawMascot } from "@/components/MeawMascot";
import { trpc } from "@/trpc/react";

export default function UnsubscribePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = use(params);
  const unsubscribeMutation = trpc.notifications.unsubscribe.useMutation();
  const [status, setStatus] = useState<"pending" | "success" | "failed">(
    "pending",
  );
  const calledRef = useRef(false);

  useEffect(() => {
    if (!token || calledRef.current) return;
    calledRef.current = true;
    unsubscribeMutation
      .mutateAsync({ token })
      .then((res) => {
        setStatus(res.success ? "success" : "failed");
      })
      .catch(() => {
        setStatus("failed");
      });
  }, [token, unsubscribeMutation]);

  return (
    <main className="mx-auto w-full max-w-md rounded-(--dash-radius) border border-(--dash-line-solid) bg-(--dash-surface) p-8 text-center text-(--dash-fg)">
      <MeawMascot
        mood={status === "pending" ? "loading" : "idle"}
        size={64}
        className="mx-auto mb-5"
      />
      <h1 className="text-xl font-semibold text-(--dash-fg)">
        {status === "pending"
          ? "Unsubscribing…"
          : status === "success"
            ? "Unsubscribed"
            : "Invalid Link"}
      </h1>

      <p className="mt-3 text-sm leading-6 text-(--dash-ash)">
        {status === "pending"
          ? "Updating your notification preferences…"
          : status === "success"
            ? "You will no longer receive payment notification emails from Meaw."
            : "This unsubscribe link is invalid or has already been processed."}
      </p>

      <div className="mt-6 flex justify-center">
        <Link href="/dashboard" className={dashButtonPrimary}>
          Return to Meaw
        </Link>
      </div>
    </main>
  );
}
