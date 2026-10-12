import "server-only";
import { randomBytes } from "node:crypto";
import {
  getNotificationLogs,
  getNotificationSettings,
  type NotificationLogDoc,
  type NotificationSettingsDoc,
} from "../../db/mongo";

export function generateUnsubscribeToken(): string {
  return randomBytes(24).toString("hex");
}

export async function findSettingsByWallet(
  walletAddress: string,
): Promise<NotificationSettingsDoc | null> {
  const collection = await getNotificationSettings();
  const address = walletAddress.toLowerCase();
  return collection.findOne({
    $or: [{ _id: address }, { _id: walletAddress }],
  });
}

export async function findSettingsByPrivyUserId(
  privyUserId: string,
): Promise<NotificationSettingsDoc | null> {
  const collection = await getNotificationSettings();
  return collection.findOne({ privyUserId });
}

export async function upsertNotificationSettings(
  walletAddress: string,
  privyUserId: string,
  email: string,
  enabled: boolean,
  events: {
    invoicePaid: boolean;
    requestReceived: boolean;
    requestPaid: boolean;
  },
): Promise<NotificationSettingsDoc> {
  const collection = await getNotificationSettings();
  const now = new Date();
  const address = walletAddress.toLowerCase();

  const existing = await collection.findOne({
    $or: [{ _id: address }, { _id: walletAddress }],
  });
  const unsubscribeToken =
    existing?.unsubscribeToken ?? generateUnsubscribeToken();

  const update: NotificationSettingsDoc = {
    _id: address,
    privyUserId,
    email,
    enabled,
    events,
    unsubscribeToken,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  await collection.updateOne(
    { _id: address },
    { $set: update },
    { upsert: true },
  );

  return update;
}

export async function disableByUnsubscribeToken(
  token: string,
): Promise<boolean> {
  const collection = await getNotificationSettings();
  const res = await collection.updateOne(
    { unsubscribeToken: token },
    { $set: { enabled: false, updatedAt: new Date() } },
  );
  return res.modifiedCount > 0;
}

export async function recordNotificationLog(
  eventKey: string,
  recipientEmail: string,
  eventType: NotificationLogDoc["eventType"],
): Promise<boolean> {
  const collection = await getNotificationLogs();
  try {
    await collection.insertOne({
      _id: eventKey,
      recipientEmail,
      eventType,
      sentAt: new Date(),
    });
    return true;
  } catch (error: unknown) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code: unknown }).code === 11000
    ) {
      return false; // Duplicate event key
    }
    throw error;
  }
}
