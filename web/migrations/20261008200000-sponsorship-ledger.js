export async function up(db) {
  await db
    .collection("sponsorship_actions")
    .createIndex(
      { "action.intent.chainId": 1, "action.intent.actionId": 1 },
      { name: "sponsorship_action_history", unique: true },
    );
  await db
    .collection("sponsorship_ledgers")
    .createIndex({ "bootstrap.state": 1 }, { name: "sponsorship_baseline" });
  await db
    .collection("sponsorship_receipts")
    .createIndex(
      { chainId: 1, hash: 1 },
      { name: "sponsorship_receipt_identity", unique: true },
    );
}
export async function down(db) {
  for (const [collection, name] of [
    ["sponsorship_actions", "sponsorship_action_history"],
    ["sponsorship_ledgers", "sponsorship_baseline"],
    ["sponsorship_receipts", "sponsorship_receipt_identity"],
  ]) {
    try {
      await db.collection(collection).dropIndex(name);
    } catch (error) {
      if (error.codeName !== "IndexNotFound") throw error;
    }
  }
}
