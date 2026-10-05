import {describe,expect,it} from "vitest";
import {openIsolatedRequestDb} from "./helpers/requestDb";
describe("durable request migrations",()=>{
  it("runs journal and operation index migrations without deleting records on rollback",async()=>{
    const db=await openIsolatedRequestDb();
    try{
      const journal=await import("../migrations/20261005110000-relay-journal.js");
      const operations=await import("../migrations/20261005120000-request-operations.js");
      await journal.up(db.db);await operations.up(db.db);
      await db.db.collection("relay_sends").insertOne({marker:"retained"});
      await operations.down(db.db);await journal.down(db.db);
      expect(await db.db.collection("relay_sends").countDocuments({marker:"retained"})).toBe(1);
    }finally{await db.close();}
  });
});
