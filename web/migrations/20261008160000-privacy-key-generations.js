export async function up(db) {
  await db
    .collection("privacy_cashouts")
    .createIndex(
      { owner: 1, registry: 1, released: 1 },
      { name: "privacy_cashout_pending" },
    );
  await db
    .collection("privacy_cashouts")
    .createIndex(
      { operationId: 1 },
      { name: "privacy_cashout_operation", unique: true },
    );
  await db
    .collection("privacy_recovery_changes")
    .createIndex(
      { owner: 1, registry: 1, released: 1, createdAt: 1 },
      { name: "privacy_recovery_pending" },
    );
  await db
    .collection("privacy_key_accounts")
    .createIndex(
      { "state.owner": 1, "state.registry": 1 },
      { name: "privacy_account_owner_registry", unique: true },
    );
  await db
    .collection("privacy_key_rotations")
    .createIndex(
      { id: 1, owner: 1, registry: 1 },
      { name: "privacy_rotation_identity", unique: true },
    );
  await db.collection("privacy_key_rotations").createIndex(
    { owner: 1, registry: 1 },
    {
      name: "privacy_rotation_pending",
      unique: true,
      partialFilterExpression: { pending: true },
    },
  );
}
export async function down(db) {
  await db
    .collection("privacy_cashouts")
    .dropIndex("privacy_cashout_operation");
  await db.collection("privacy_cashouts").dropIndex("privacy_cashout_pending");
  await db
    .collection("privacy_recovery_changes")
    .dropIndex("privacy_recovery_pending");
  await db
    .collection("privacy_key_rotations")
    .dropIndex("privacy_rotation_pending");
  await db
    .collection("privacy_key_rotations")
    .dropIndex("privacy_rotation_identity");
  await db
    .collection("privacy_key_accounts")
    .dropIndex("privacy_account_owner_registry");
}
