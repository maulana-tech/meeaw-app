/**
 * Creates `payment_requests`: signed request metadata, two opaque fixed-size
 * envelopes and public status. The validator forbids plaintext fields
 * (additionalProperties: false), so an amount, note or salt can never be
 * stored by mistake. Indexes match REQUEST_INDEXES in
 * src/server/modules/requests/requests.repository.ts; keep them in sync.
 *
 * @param db {import('mongodb').Db}
 * @returns {Promise<void>}
 */

const participant = {
  bsonType: "object",
  required: ["username", "wallet", "notePubkey", "viewPubkey"],
  additionalProperties: false,
  properties: {
    username: { bsonType: "string", pattern: "^[a-z0-9_]{3,32}$" },
    wallet: { bsonType: "string", pattern: "^0x[0-9a-f]{40}$" },
    notePubkey: { bsonType: "string", pattern: "^0x[0-9a-f]{64}$" },
    viewPubkey: { bsonType: "string", pattern: "^0x[0-9a-f]{64}$" },
  },
};

const envelope = {
  bsonType: "object",
  required: ["ephemeralPk", "ciphertext"],
  additionalProperties: false,
  properties: {
    ephemeralPk: { bsonType: "binData" },
    ciphertext: { bsonType: "binData" },
  },
};

const validator = {
  $jsonSchema: {
    bsonType: "object",
    additionalProperties: false,
    required: [
      "_id",
      "version",
      "scope",
      "requesterWallet",
      "addresseeWallet",
      "requester",
      "addressee",
      "createdAt",
      "recipientCommitment",
      "requesterEnvelope",
      "addresseeEnvelope",
      "signature",
      "digest",
      "status",
      "revision",
      "operationId",
      "reservation",
      "receipt",
      "updatedAt",
    ],
    properties: {
      _id: { bsonType: "string" },
      version: { enum: [1] },
      scope: { bsonType: "string" },
      requesterWallet: { bsonType: "string" },
      addresseeWallet: { bsonType: "string" },
      requester: participant,
      addressee: participant,
      createdAt: { bsonType: "date" },
      recipientCommitment: { bsonType: "string" },
      requesterEnvelope: envelope,
      addresseeEnvelope: envelope,
      signature: { bsonType: "string" },
      digest: { bsonType: "string" },
      status: { enum: ["pending", "paid", "declined", "cancelled"] },
      revision: { bsonType: ["int", "long"] },
      operationId: { bsonType: ["string", "null"] },
      reservation: {
        bsonType: ["object", "null"],
        additionalProperties: false,
        required: ["attemptId", "phase", "updatedAt"],
        properties: {
          attemptId: { bsonType: "string" },
          phase: {
            enum: [
              "preparing",
              "submitting",
              "submitted",
              "confirmed",
              "failed",
              "needsReconciliation",
            ],
          },
          updatedAt: { bsonType: "date" },
          completedMerges:{bsonType:["int","long"]},
          nextStep:{bsonType:["int","long"]},
          txHash:{bsonType:["string","null"]},
          relayWallet:{bsonType:["string","null"]},
          currentDigest:{bsonType:["string","null"]},
          currentSubmission:{
            bsonType:["object","null"],additionalProperties:false,
            properties:{
              version:{enum:[1]},requestId:{bsonType:"string"},operationId:{bsonType:"string"},step:{bsonType:["int","long"]},
              pool:{bsonType:"string"},kind:{enum:["merge","split","payment"]},root:{bsonType:"string"},nullifiers:{bsonType:"array",items:{bsonType:"string"}},
              proof:{bsonType:"object",additionalProperties:false,properties:{a:{bsonType:"array"},b:{bsonType:"array"},c:{bsonType:"array"}}},
              outputs:{bsonType:"array",items:{bsonType:"object",additionalProperties:false,properties:{commitment:{bsonType:"string"},ephemeralPk:{bsonType:"string"},ciphertext:{bsonType:"string"}}}},
              signature:{bsonType:"string"},
            },
          },
        },
      },
      receipt: {
        bsonType: ["object", "null"],
        additionalProperties: false,
        required: ["txHash", "leafIndex", "block"],
        properties: {
          txHash: { bsonType: "string" },
          leafIndex: { bsonType: ["int", "long"] },
          block: { bsonType: ["int", "long"] },
        },
      },
      updatedAt: { bsonType: "date" },
    },
  },
};

export const indexes = [
  {
    key: { scope: 1, recipientCommitment: 1 },
    name: "scope_commitment_unique",
    unique: true,
  },
  {
    key: { requesterWallet: 1, createdAt: -1, _id: -1 },
    name: "requester_created",
  },
  {
    key: { addresseeWallet: 1, createdAt: -1, _id: -1 },
    name: "addressee_created",
  },
  { key: { addresseeWallet: 1, status: 1 }, name: "addressee_status" },
  { key: { requesterWallet: 1, status: 1 }, name: "requester_status" },
  {
    key: { operationId: 1 },
    name: "operation_unique",
    unique: true,
    partialFilterExpression: { operationId: { $type: "string" } },
  },
];

export const up = async (db) => {
  const existing = await db
    .listCollections({ name: "payment_requests" })
    .toArray();
  if (existing.length === 0) {
    await db.createCollection("payment_requests", {
      validator,
      validationLevel: "strict",
    });
  } else {
    await db.command({
      collMod: "payment_requests",
      validator,
      validationLevel: "strict",
    });
  }
  await db.collection("payment_requests").createIndexes(indexes);
};

/**
 * Removes the validator and indexes but keeps every stored request: request
 * history is never deleted by a rollback.
 *
 * @param db {import('mongodb').Db}
 * @returns {Promise<void>}
 */
export const down = async (db) => {
  const existing = await db
    .listCollections({ name: "payment_requests" })
    .toArray();
  if (existing.length === 0) return;
  await db.command({
    collMod: "payment_requests",
    validator: {},
    validationLevel: "off",
  });
  for (const index of indexes) {
    await db
      .collection("payment_requests")
      .dropIndex(index.name)
      .catch(() => {});
  }
};
