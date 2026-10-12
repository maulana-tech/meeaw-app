"use client";

import { usePrivy } from "@privy-io/react-auth";
import { Loader } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { toast } from "sonner";
import { dashButtonPrimary, dashCell } from "../../components/dashboard/styles";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { trpc } from "../../trpc/react";

export function EmailNotificationsRow() {
  const { user } = usePrivy();
  const query = trpc.notifications?.getSettings?.useQuery?.() ?? {
    data: undefined,
    isLoading: false,
    refetch: async () => {},
  };
  const updateMutation =
    trpc.notifications?.updateSettings?.useMutation?.() ?? {
      mutateAsync: async () => {},
      isPending: false,
    };
  const testMutation = trpc.notifications?.sendTest?.useMutation?.() ?? {
    mutateAsync: async () => {},
    isPending: false,
  };

  const [email, setEmail] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [events, setEvents] = useState({
    invoicePaid: true,
    requestReceived: true,
    requestPaid: true,
  });
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (query.data && !initialized) {
      if (query.data.settings) {
        setEmail(query.data.settings.email);
        setEnabled(query.data.settings.enabled);
        setEvents(query.data.settings.events);
      } else {
        const privyEmail = user?.email?.address || user?.google?.email || "";
        if (privyEmail) {
          setEmail(privyEmail);
        }
      }
      setInitialized(true);
    }
  }, [query.data, initialized, user]);

  useEffect(() => {
    if (!query.data?.settings && !email) {
      const privyEmail = user?.email?.address || user?.google?.email || "";
      if (privyEmail) {
        setEmail(privyEmail);
      }
    }
  }, [user, query.data, email]);

  const serviceAvailable = query.data?.serviceAvailable ?? false;

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!email.trim() || !email.includes("@")) {
      toast.error("Please enter a valid email address.");
      return;
    }

    try {
      await updateMutation.mutateAsync({
        email: email.trim(),
        enabled,
        events,
      });
      await query.refetch();
      toast.success("Notification preferences saved");
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to save preferences";
      toast.error(message);
    }
  }

  async function handleSendTest() {
    try {
      await testMutation.mutateAsync();
      toast.success("Test email sent! Check your inbox.");
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to send test email";
      toast.error(message);
    }
  }

  return (
    <section className={`${dashCell} p-6`}>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h2 className="dashboard-tile-title">Email notifications</h2>
        {!serviceAvailable ? (
          <Badge
            variant="outline"
            className="border-(--dash-line) text-(--dash-ash)"
          >
            Service not configured
          </Badge>
        ) : enabled ? (
          <Badge className="gap-1.5 border border-(--dash-line) bg-transparent text-(--dash-fg)">
            <span
              className="size-1.5 rounded-full bg-(--dash-accent)"
              aria-hidden="true"
            />
            Active
          </Badge>
        ) : (
          <Badge
            variant="outline"
            className="border-(--dash-line) text-(--dash-ash)"
          >
            Disabled
          </Badge>
        )}
      </div>

      <div className="mt-3 max-w-xl text-sm leading-6 text-(--dash-ash)">
        Get notified when invoices or requests are settled. Emails never reveal
        your private balance or keys.
      </div>

      <form onSubmit={handleSave} noValidate className="mt-5 space-y-5">
        <div className="flex items-center gap-3">
          <input
            id="notify-enabled"
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="size-4 rounded border-(--dash-line-strong) bg-(--dash-tint) text-(--dash-fg) focus:ring-(--dash-fg)"
          />
          <Label
            htmlFor="notify-enabled"
            className="cursor-pointer text-sm font-medium text-(--dash-fg)"
          >
            Enable email notifications
          </Label>
        </div>

        {enabled && (
          <div className="space-y-4 rounded-(--dash-radius-sm) border border-(--dash-line) bg-(--dash-tint) p-4">
            <div className="space-y-2">
              <Label
                htmlFor="notify-email"
                className="text-xs font-medium uppercase tracking-wider text-(--dash-ash)"
              >
                Notification Email
              </Label>
              <Input
                id="notify-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                appearance="linen"
                className="max-w-md"
                required
              />
            </div>

            <div className="space-y-3 pt-2">
              <p className="text-xs font-medium uppercase tracking-wider text-(--dash-ash)">
                Events to receive
              </p>

              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={events.invoicePaid}
                  onChange={(e) =>
                    setEvents({ ...events, invoicePaid: e.target.checked })
                  }
                  className="mt-0.5 size-4 rounded border-(--dash-line-strong) bg-(--dash-surface) text-(--dash-fg) focus:ring-(--dash-fg)"
                />
                <div>
                  <span className="text-sm font-medium text-(--dash-fg)">
                    Invoice settled
                  </span>
                  <p className="text-xs text-(--dash-ash)">
                    When a client settles an invoice you created
                  </p>
                </div>
              </label>

              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={events.requestReceived}
                  onChange={(e) =>
                    setEvents({ ...events, requestReceived: e.target.checked })
                  }
                  className="mt-0.5 size-4 rounded border-(--dash-line-strong) bg-(--dash-surface) text-(--dash-fg) focus:ring-(--dash-fg)"
                />
                <div>
                  <span className="text-sm font-medium text-(--dash-fg)">
                    Payment request received
                  </span>
                  <p className="text-xs text-(--dash-ash)">
                    When another user requests a payment from you
                  </p>
                </div>
              </label>

              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={events.requestPaid}
                  onChange={(e) =>
                    setEvents({ ...events, requestPaid: e.target.checked })
                  }
                  className="mt-0.5 size-4 rounded border-(--dash-line-strong) bg-(--dash-surface) text-(--dash-fg) focus:ring-(--dash-fg)"
                />
                <div>
                  <span className="text-sm font-medium text-(--dash-fg)">
                    Payment request settled
                  </span>
                  <p className="text-xs text-(--dash-ash)">
                    When a request you sent is settled
                  </p>
                </div>
              </label>
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={updateMutation.isPending}
            className={dashButtonPrimary}
          >
            {updateMutation.isPending ? "Saving…" : "Save preferences"}
          </button>

          {serviceAvailable && enabled && query.data?.settings?.enabled && (
            <Button
              type="button"
              variant="outline"
              disabled={testMutation.isPending}
              onClick={handleSendTest}
            >
              {testMutation.isPending ? (
                <>
                  <Loader
                    className="size-3.5 animate-spin"
                    aria-hidden="true"
                  />
                  Sending…
                </>
              ) : (
                "Send test email"
              )}
            </Button>
          )}
        </div>
      </form>
    </section>
  );
}
