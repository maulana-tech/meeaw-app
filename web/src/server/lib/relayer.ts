import "server-only";
import {randomUUID} from "node:crypto";
import {type Abi,type ContractFunctionArgs,type ContractFunctionName,createPublicClient,encodeFunctionData,type Hash,http,type TransactionReceipt} from "viem";
import {privateKeyToAccount} from "viem/accounts";
import {getServerEnv} from "../../env.server";
import {chain,rpcUrl} from "../../lib/chain";
import {runtimeSender,type RelayIntent} from "./durableRelayer";

export function relayerConfigured(){return Boolean(getServerEnv().RELAYER_PRIVATE_KEY);}
export function relayerAddress():string|null{
  const key=getServerEnv().RELAYER_PRIVATE_KEY;return key?privateKeyToAccount(key as `0x${string}`).address:null;
}
let queue:Promise<unknown>=Promise.resolve();
/** Every ordinary send shares the persistent wallet fence with request sends. */
export function relayWrite<const abi extends Abi,functionName extends ContractFunctionName<abi,"nonpayable"|"payable">>(request:{address:`0x${string}`;abi:abi;functionName:functionName;args:ContractFunctionArgs<abi,"nonpayable"|"payable",functionName>}):Promise<{hash:Hash;receipt:TransactionReceipt}>{
  const run=async()=>{
    const env=getServerEnv();if(!env.RELAYER_PRIVATE_KEY)throw new Error("The gasless relayer is not configured.");
    const account=privateKeyToAccount(env.RELAYER_PRIVATE_KEY as `0x${string}`);
    const reader=createPublicClient({chain,transport:http(env.RELAYER_RPC_URL??rpcUrl)});
    await reader.simulateContract({...request,account} as Parameters<typeof reader.simulateContract>[0]);
    const intent:RelayIntent={operationKey:`ordinary:${randomUUID()}`,chainId:chain.id,wallet:account.address,to:request.address,data:encodeFunctionData({abi:request.abi,functionName:request.functionName,args:request.args} as Parameters<typeof encodeFunctionData>[0]),confirmations:1};
    const {sender}=await runtimeSender();const prepared=await sender.prepare(intent);
    await sender.broadcast(intent);
    const receipt=await reader.waitForTransactionReceipt({hash:prepared.txHash,confirmations:1,timeout:30_000});
    const result=await sender.reconcile(intent);
    if(result.state==="reverted")throw new Error("Relayed transaction reverted.");
    if(result.state!=="confirmed")throw new Error("Transaction confirmation is still being checked.");
    return {hash:prepared.txHash,receipt};
  };
  const next=queue.then(run,run);queue=next.catch(()=>{});return next;
}
