module.exports = {
  async up(db) {
    await db.collection("spend_claims").createIndex({"active.operationKey":1},{name:"spend_operation"});
    await db.collection("spend_nullifiers").createIndex({ownerKey:1,operationId:1,fence:1},{name:"spend_owner"});
  },
  async down(db) {
    await db.collection("spend_claims").dropIndex("spend_operation");
    await db.collection("spend_nullifiers").dropIndex("spend_owner");
  },
};
