import {getServerEnv} from "../../../../env.server";
import {reconcileAllRelays} from "../../../../server/lib/durableRelayer";
import {relayerConfigured} from "../../../../server/lib/relayer";
import {reconcilePendingRequests} from "../../../../server/modules/requests/requestOperations";
export const dynamic="force-dynamic";
export async function GET(request:Request){
  const secret=getServerEnv().CRON_SECRET;
  if(!secret||request.headers.get("authorization")!==`Bearer ${secret}`)return Response.json({error:"Unauthorized"},{status:401});
  if(!relayerConfigured())return Response.json({status:"unavailable"});
  try{
    const relays=await reconcileAllRelays(20),requests=await reconcilePendingRequests({limit:20});
    console.info("[request-payments]",JSON.stringify({relays,requests}));
    return Response.json({status:"checked",relays,requests});
  }catch{return Response.json({error:"Reconciliation is temporarily unavailable."},{status:503});}
}
