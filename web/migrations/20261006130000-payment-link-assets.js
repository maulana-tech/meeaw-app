export async function up(db){
  // Preserve integer amounts and capability tokens; fill legacy metadata only.
  const decimals=Number(process.env.NEXT_PUBLIC_USDC_DECIMALS??6);
  if(!Number.isInteger(decimals)||decimals<0||decimals>18)throw new Error("Invalid legacy token precision.");
  await db.collection("payment_links").updateMany({asset:{$exists:false}},{$set:{asset:"USDC"}});
  await db.collection("payment_links").updateMany({asset:"USDC",tokenDecimals:{$exists:false}},{$set:{tokenDecimals:decimals}});
}
export async function down(){/* Metadata is additive and must not erase payment history. */}
