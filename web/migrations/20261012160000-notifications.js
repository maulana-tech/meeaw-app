export async function up(db) {
  await db.collection("notification_settings").createIndexes([
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
  await db.collection("notification_logs").createIndexes([
    {
      key: { sentAt: 1 },
      name: "notification_logs_sent_at_ttl",
      expireAfterSeconds: 2592000,
    },
  ]);
}

export async function down(db) {
  for (const [collection, names] of [
    [
      "notification_settings",
      [
        "notification_settings_privy_user_id",
        "notification_settings_unsubscribe_token",
      ],
    ],
    ["notification_logs", ["notification_logs_sent_at_ttl"]],
  ]) {
    for (const name of names) {
      try {
        await db.collection(collection).dropIndex(name);
      } catch (error) {
        if (error.code !== 27 && error.code !== 26) throw error;
      }
    }
  }
}
