import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { getServerEnv } from "../../../env.server";
import { rateLimit } from "../../lib/rateLimit";
import {
  createTRPCRouter,
  protectedProcedure,
  publicProcedure,
} from "../../trpc";
import { currentWallet } from "../wallets/wallets.service";
import {
  disableByUnsubscribeToken,
  findSettingsByWallet,
  upsertNotificationSettings,
} from "./notifications.repository";
import { sendTestEmail } from "./notifications.service";

const updateSettingsInput = z
  .object({
    email: z.string().trim(),
    enabled: z.boolean(),
    events: z.object({
      invoicePaid: z.boolean(),
      requestReceived: z.boolean(),
      requestPaid: z.boolean(),
    }),
  })
  .superRefine((data, ctx) => {
    if (data.enabled || data.email.length > 0) {
      const emailCheck = z.string().email().safeParse(data.email);
      if (!emailCheck.success) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Invalid email",
          path: ["email"],
        });
      }
    }
  });

export const notificationsRouter = createTRPCRouter({
  getSettings: protectedProcedure.query(async ({ ctx }) => {
    const env = getServerEnv();
    const serviceAvailable = Boolean(env.RESEND_API_KEY);
    const wallet = await currentWallet(ctx.privyUserId);
    if (!wallet) {
      return { serviceAvailable, settings: null };
    }

    const settings = await findSettingsByWallet(wallet.address);
    return {
      serviceAvailable,
      settings: settings
        ? {
            email: settings.email,
            enabled: settings.enabled,
            events: settings.events,
          }
        : null,
    };
  }),

  updateSettings: protectedProcedure
    .input(updateSettingsInput)
    .mutation(async ({ ctx, input }) => {
      const wallet = await currentWallet(ctx.privyUserId);
      if (!wallet) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "No Meaw wallet is linked to this account.",
        });
      }

      return upsertNotificationSettings(
        wallet.address,
        ctx.privyUserId,
        input.email,
        input.enabled,
        input.events,
      );
    }),

  sendTest: protectedProcedure.mutation(async ({ ctx }) => {
    if (
      !rateLimit(`notifications:test:${ctx.privyUserId}`, 3, 10 * 60_000).ok
    ) {
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: "You can send up to 3 test emails every 10 minutes.",
      });
    }

    const wallet = await currentWallet(ctx.privyUserId);
    if (!wallet) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "No Meaw wallet is linked to this account.",
      });
    }

    const ok = await sendTestEmail(wallet.address);
    if (!ok) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message:
          "Failed to send test email. Ensure your email is configured and saved.",
      });
    }

    return { success: true };
  }),

  unsubscribe: publicProcedure
    .input(z.object({ token: z.string().trim().min(1) }))
    .mutation(async ({ ctx, input }) => {
      if (
        !rateLimit(
          `notifications:unsubscribe:${ctx.ip ?? "unknown"}`,
          30,
          60_000,
        ).ok
      ) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: "Too many attempts. Try again shortly.",
        });
      }

      const success = await disableByUnsubscribeToken(input.token);
      return { success };
    }),
});
