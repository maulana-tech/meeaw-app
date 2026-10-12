import { describe, expect, it, vi } from "vitest";
import { serverEnvSchema } from "../src/env.server";
import {
  getNotificationLogs,
  getNotificationSettings,
} from "../src/server/db/mongo";
import {
  down as migrationDown,
  up as migrationUp,
} from "../migrations/20261012160000-notifications.js";

describe("Notification Environment Schema", () => {
  it("parses optional RESEND_API_KEY, EMAIL_FROM, and APP_URL", () => {
    const parsed = serverEnvSchema.parse({
      RESEND_API_KEY: "re_123456789",
      EMAIL_FROM: "Meaw <hello@meaw.xyz>",
      APP_URL: "https://meaw.xyz",
    });
    expect(parsed.RESEND_API_KEY).toBe("re_123456789");
    expect(parsed.EMAIL_FROM).toBe("Meaw <hello@meaw.xyz>");
    expect(parsed.APP_URL).toBe("https://meaw.xyz");
  });

  it("handles empty or missing env values gracefully", () => {
    const parsed = serverEnvSchema.parse({});
    expect(parsed.RESEND_API_KEY).toBeUndefined();
    expect(parsed.EMAIL_FROM).toBeUndefined();
    expect(parsed.APP_URL).toBeUndefined();
  });
});

describe("Notification Database Schema & Migration", () => {
  it("exports collection getters for notification settings and logs", () => {
    expect(typeof getNotificationSettings).toBe("function");
    expect(typeof getNotificationLogs).toBe("function");
  });

  it("applies and rolls back indexes in migration", async () => {
    const createdIndexes: Record<string, unknown[]> = {
      notification_settings: [],
      notification_logs: [],
    };
    const droppedIndexes: Record<string, string[]> = {
      notification_settings: [],
      notification_logs: [],
    };

    const mockDb = {
      collection: (name: string) => ({
        createIndexes: vi.fn(async (indexes: unknown[]) => {
          createdIndexes[name].push(...indexes);
        }),
        dropIndex: vi.fn(async (indexName: string) => {
          droppedIndexes[name].push(indexName);
        }),
      }),
    } as any;

    await migrationUp(mockDb);

    expect(createdIndexes.notification_settings).toEqual([
      {
        key: { privyUserId: 1 },
        name: "notification_settings_privy_user_id",
        unique: true,
      },
      {
        key: { unsubscribeToken: 1 },
        name: "notification_settings_unsubscribe_token",
        unique: true,
      },
    ]);

    expect(createdIndexes.notification_logs).toEqual([
      {
        key: { sentAt: 1 },
        name: "notification_logs_sent_at_ttl",
        expireAfterSeconds: 2592000,
      },
    ]);

    await migrationDown(mockDb);

    expect(droppedIndexes.notification_settings).toEqual([
      "notification_settings_privy_user_id",
      "notification_settings_unsubscribe_token",
    ]);
    expect(droppedIndexes.notification_logs).toEqual([
      "notification_logs_sent_at_ttl",
    ]);
  });
});
