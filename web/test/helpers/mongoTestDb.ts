import { randomUUID } from "node:crypto";
import { type Db, MongoClient } from "mongodb";

// Real-Mongo tests run against a uniquely named, disposable database on the
// local server (never the configured application database). Dispose drops
// only a database this helper created.
const PREFIX = "mawee_test_";
const URI = process.env.MAWEE_TEST_MONGODB_URI ?? "mongodb://localhost:27017";

export type IsolatedDb = {
  db: Db;
  client: MongoClient;
  dispose(): Promise<void>;
};

export async function mongoAvailable(): Promise<boolean> {
  const client = new MongoClient(URI, { serverSelectionTimeoutMS: 1500 });
  try {
    await client.connect();
    await client.db("admin").command({ ping: 1 });
    return true;
  } catch {
    return false;
  } finally {
    await client.close().catch(() => {});
  }
}

export async function openIsolatedDb(): Promise<IsolatedDb> {
  const client = await new MongoClient(URI, {
    serverSelectionTimeoutMS: 3000,
  }).connect();
  const name = `${PREFIX}${randomUUID().replaceAll("-", "")}`;
  const db = client.db(name);
  return {
    db,
    client,
    async dispose() {
      if (!db.databaseName.startsWith(PREFIX))
        throw new Error("Refusing to drop a non-test database.");
      await db.dropDatabase();
      await client.close();
    },
  };
}
