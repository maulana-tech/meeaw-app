export const up=async(db)=>{
  await db.collection("request_operations").createIndex({requestId:1},{name:"request_operation_history"});
  await db.collection("request_payment_steps").createIndex({operationId:1,step:1},{unique:true,name:"operation_step"});
};
export const down=async(db)=>{
  for(const [collection,name] of [["request_operations","request_operation_history"],["request_payment_steps","operation_step"]]){
    try{await db.collection(collection).dropIndex(name);}catch(e){if(e.codeName!=="IndexNotFound")throw e;}
  }
};
