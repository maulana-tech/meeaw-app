export async function up(db) {
  await db.collection("invoices").createIndexes([
    {
      key: { ownerWallet: 1, number: 1 },
      name: "invoice_owner_number",
      unique: true,
    },
    { key: { token: 1 }, name: "invoice_token", unique: true },
    { key: { commitment: 1 }, name: "invoice_commitment", unique: true },
    {
      key: { ownerPrivyUserId: 1, createdAt: -1, _id: -1 },
      name: "invoice_owner_created",
    },
    {
      key: { status: 1, checkedAt: 1, _id: 1 },
      name: "invoice_reconciliation",
    },
  ]);
  await db
    .collection("deposits")
    .createIndex(
      { scope: 1, commitment: 1 },
      { name: "invoice_deposit_lookup" },
    );
}
export async function down(db) {
  for (const [collection, names] of [
    [
      "invoices",
      [
        "invoice_owner_number",
        "invoice_token",
        "invoice_commitment",
        "invoice_owner_created",
        "invoice_reconciliation",
      ],
    ],
    ["deposits", ["invoice_deposit_lookup"]],
  ]) {
    for (const name of names)
      try {
        await db.collection(collection).dropIndex(name);
      } catch (error) {
        if (error.code !== 27 && error.code !== 26) throw error;
      }
  }
}
