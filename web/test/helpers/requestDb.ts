import { randomUUID } from "node:crypto";
import { MongoClient } from "mongodb";
import type { PaymentRequestDoc } from "../../src/server/db/mongo";
import { REQUEST_INDEXES } from "../../src/server/modules/requests/requests.repository";

/** Only an isolated, test-owned local database can be dropped by this helper. */
export async function openIsolatedRequestDb() {
  const name = `mawee_request_test_${randomUUID().replaceAll("-", "")}`;
  const client = new MongoClient("mongodb://127.0.0.1:27017", {serverSelectionTimeoutMS:5000});
  await client.connect();
  const db=client.db(name);
  const requests=db.collection<PaymentRequestDoc>("payment_requests");
  await requests.createIndexes(REQUEST_INDEXES);
  return {client,db,requests,async close(){
    if(!/^mawee_request_test_[a-f0-9]{32}$/.test(db.databaseName)) throw new Error("Unsafe test database cleanup.");
    await db.dropDatabase(); await client.close();
  }};
}
