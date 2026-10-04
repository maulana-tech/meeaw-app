/**
 * Adds the public spent-nullifier mirror used by the asynchronous pool indexer.
 * The worker resets mirrored rows automatically if the configured chain or
 * pool address changes.
 *
 * @param db {import('mongodb').Db}
 * @returns {Promise<void>}
 */
export const up = async (db) => {
  const collections = await db
    .listCollections({ name: "spent_nullifiers" })
    .toArray();
  if (collections.length === 0) {
    await db.createCollection("spent_nullifiers", {
      validator: {
        $jsonSchema: {
          bsonType: "object",
          required: ["_id", "block", "txHash", "ts"],
          properties: {
            _id: { bsonType: "string" },
            block: { bsonType: "number" },
            txHash: { bsonType: "string" },
            ts: { bsonType: "date" },
          },
        },
      },
      validationLevel: "moderate",
    });
  }
  for (const collectionName of ["spent_nullifiers", "deposits"]) {
    const collection = db.collection(collectionName);
    const indexes = await collection.indexes();
    const hasBlockIndex = indexes.some(
      (index) => Object.keys(index.key).length === 1 && index.key.block === 1,
    );
    if (!hasBlockIndex) {
      await collection.createIndex({ block: 1 }, { name: "block_asc" });
    }
  }
};

/**
 * @param db {import('mongodb').Db}
 * @returns {Promise<void>}
 */
export const down = async (db) => {
  await db
    .collection("deposits")
    .dropIndex("block_asc")
    .catch(() => {});
  await db.collection("spent_nullifiers").drop();
};
