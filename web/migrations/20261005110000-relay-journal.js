export const up=async(db)=>{
  await db.collection("relay_sends").createIndex({walletKey:1,operationKey:1},{unique:true,name:"wallet_operation"});
  await db.collection("relay_wallets").createIndex({"active.phase":1},{name:"active_reconciliation"});
};
export const down=async(db)=>{
  for(const [collection,name] of [["relay_sends","wallet_operation"],["relay_wallets","active_reconciliation"]]){
    try{await db.collection(collection).dropIndex(name);}catch(e){if(e.codeName!=="IndexNotFound")throw e;}
  }
};
