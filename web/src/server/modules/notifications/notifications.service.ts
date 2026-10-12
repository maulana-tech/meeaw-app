import "server-only";
import { getServerEnv } from "../../../env.server";
import { buildEmailHtml, buildEmailText, sendEmail } from "../../lib/email";
import {
  findSettingsByWallet,
  recordNotificationLog,
} from "./notifications.repository";

export function formatInvoiceNotification(params: {
  invoiceNumber: string;
  amountFormatted: string;
  appUrl: string;
  unsubscribeToken: string;
}): { subject: string; html: string; text: string } {
  const { invoiceNumber, amountFormatted, appUrl, unsubscribeToken } = params;
  const title = `Invoice ${invoiceNumber} settled`;
  const message = `Your invoice ${invoiceNumber} for ${amountFormatted} has been paid into your private balance.`;
  const actionLabel = "View Invoices";
  const actionUrl = `${appUrl}/invoices`;
  const unsubscribeUrl = `${appUrl}/unsubscribe/${unsubscribeToken}`;

  return {
    subject: `Invoice ${invoiceNumber} has been paid`,
    html: buildEmailHtml({
      title,
      message,
      actionLabel,
      actionUrl,
      unsubscribeUrl,
    }),
    text: buildEmailText({
      title,
      message,
      actionLabel,
      actionUrl,
      unsubscribeUrl,
    }),
  };
}

export function formatRequestReceivedNotification(params: {
  requesterUsername: string;
  appUrl: string;
  unsubscribeToken: string;
}): { subject: string; html: string; text: string } {
  const { requesterUsername, appUrl, unsubscribeToken } = params;
  const title = "Payment request received";
  const message = `@${requesterUsername} sent you a payment request. Open Meaw to review and pay.`;
  const actionLabel = "Open Meaw";
  const actionUrl = `${appUrl}/dashboard`;
  const unsubscribeUrl = `${appUrl}/unsubscribe/${unsubscribeToken}`;

  return {
    subject: `New payment request from @${requesterUsername}`,
    html: buildEmailHtml({
      title,
      message,
      actionLabel,
      actionUrl,
      unsubscribeUrl,
    }),
    text: buildEmailText({
      title,
      message,
      actionLabel,
      actionUrl,
      unsubscribeUrl,
    }),
  };
}

export function formatRequestPaidNotification(params: {
  addresseeUsername: string;
  appUrl: string;
  unsubscribeToken: string;
}): { subject: string; html: string; text: string } {
  const { addresseeUsername, appUrl, unsubscribeToken } = params;
  const title = "Payment request settled";
  const message = `Your payment request to @${addresseeUsername} has been paid into your private balance.`;
  const actionLabel = "Open Meaw";
  const actionUrl = `${appUrl}/dashboard`;
  const unsubscribeUrl = `${appUrl}/unsubscribe/${unsubscribeToken}`;

  return {
    subject: `Payment request to @${addresseeUsername} has been settled`,
    html: buildEmailHtml({
      title,
      message,
      actionLabel,
      actionUrl,
      unsubscribeUrl,
    }),
    text: buildEmailText({
      title,
      message,
      actionLabel,
      actionUrl,
      unsubscribeUrl,
    }),
  };
}

export async function dispatchNotification(params: {
  eventKey: string;
  recipientWallet: string;
  eventType: "invoicePaid" | "requestReceived" | "requestPaid";
  buildEmail: (settings: { unsubscribeToken: string; appUrl: string }) => {
    subject: string;
    html: string;
    text: string;
  };
}): Promise<void> {
  const env = getServerEnv();
  if (!env.RESEND_API_KEY) return;

  const settings = await findSettingsByWallet(params.recipientWallet);
  if (!settings?.enabled || !settings.events[params.eventType]) {
    return;
  }

  const reserved = await recordNotificationLog(
    params.eventKey,
    settings.email,
    params.eventType,
  );
  if (!reserved) {
    return; // Already dispatched
  }

  const appUrl = env.APP_URL || "http://localhost:3000";
  const emailData = params.buildEmail({
    unsubscribeToken: settings.unsubscribeToken,
    appUrl,
  });

  // Non-blocking fire and forget
  void sendEmail({
    to: settings.email,
    subject: emailData.subject,
    html: emailData.html,
    text: emailData.text,
  }).catch((err) => {
    console.error(`[notifications] Error dispatching ${params.eventKey}:`, err);
  });
}

export async function sendTestEmail(walletAddress: string): Promise<boolean> {
  const env = getServerEnv();
  if (!env.RESEND_API_KEY) return false;

  const settings = await findSettingsByWallet(walletAddress);
  if (!settings?.email) return false;

  const appUrl = env.APP_URL || "http://localhost:3000";
  const title = "Meaw Notification Test";
  const message =
    "Your email notification preferences are active. You will receive updates according to your settings.";
  const actionLabel = "Open Settings";
  const actionUrl = `${appUrl}/settings`;
  const unsubscribeUrl = `${appUrl}/unsubscribe/${settings.unsubscribeToken}`;

  const res = await sendEmail({
    to: settings.email,
    subject: "Meaw: Test email notification",
    html: buildEmailHtml({
      title,
      message,
      actionLabel,
      actionUrl,
      unsubscribeUrl,
    }),
    text: buildEmailText({
      title,
      message,
      actionLabel,
      actionUrl,
      unsubscribeUrl,
    }),
  });

  return res.ok;
}
