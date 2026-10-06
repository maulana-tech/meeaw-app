export const up=async(db)=>{
    await db.collection("private_transfer_steps").createIndex({transferId:1,operationId:1,step:1},{unique:true,name:"transfer_step_unique"});
    await db.collection("private_transfers").createIndexes([
      {key:{"sender.wallet":1,pool:1},unique:true,name:"one_pending_sender_pool",partialFilterExpression:{status:"pending"}},
      {key:{pool:1,recipientCommitment:1},unique:true,name:"transfer_commitment"},
      {key:{"sender.wallet":1,createdAt:-1,_id:-1},name:"transfer_sent"},
      {key:{"recipient.wallet":1,createdAt:-1,_id:-1},name:"transfer_received"},
      {key:{status:1,"operation.phase":1},name:"transfer_reconciliation"},
    ]);
};
export const down=async(db)=>{
    await db.collection("private_transfer_steps").dropIndex("transfer_step_unique");
    for(const name of ["one_pending_sender_pool","transfer_commitment","transfer_sent","transfer_received","transfer_reconciliation"])
      await db.collection("private_transfers").dropIndex(name);
};
