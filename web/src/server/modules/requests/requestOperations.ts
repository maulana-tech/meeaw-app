import "server-only";
import {verifyTypedData,type Hex} from "viem";
import {requestDigest,submissionDigest,submissionTypedData} from "../../../features/requests/requestTypedData";
import type {PaymentOperation,SignedSubmission} from "../../../features/requests/types";
import {signedSubmissionSchema} from "../../../features/requests/validation";
import {requestPool,resolvePool} from "../../../lib/pools";
import {getDb,getPaymentRequests,type PaymentRequestDoc,type RequestReservationDoc} from "../../db/mongo";
import {runtimeSender,type RelayIntent} from "../../lib/durableRelayer";
import {RelayBusyError} from "../../lib/relayJournal";
import {relayerAddress,relayerConfigured} from "../../lib/relayer";
import {RequestConflictError,RequestNotFoundError,RequestRejectedError,RequestUnavailableError} from "./requests.errors";
import {findForParticipant,toPaymentRequest} from "./requests.repository";
import {callerWallet,enforceRequestLimit} from "./requests.service";
import {encodeSubmission,verifyRequestReceipt} from "./requestSettlement";

type OperationDoc=PaymentOperation & {_id:string;payerWallet:string};
type StepDoc={_id:string;requestId:string;operationId:string;step:number;digest:string;submission:SignedSubmission;txHash:string|null};
async function collections(){const db=await getDb();return {operations:db.collection<OperationDoc>("request_operations"),steps:db.collection<StepDoc>("request_payment_steps")};}
function wire(doc:PaymentRequestDoc):PaymentOperation{
  const r=doc.reservation;if(!r||!doc.operationId)throw new RequestConflictError();
  return {id:doc.operationId,requestId:doc._id,pool:doc.scope as PaymentOperation["pool"],phase:r.phase,completedMerges:r.completedMerges,nextStep:r.nextStep,txHash:r.txHash as Hex|null,updatedAt:r.updatedAt.toISOString()};
}
async function project(doc:PaymentRequestDoc){
  const op=wire(doc);const {operations}=await collections();
  await operations.updateOne({_id:op.id},{$set:{...op,payerWallet:doc.addresseeWallet}},{upsert:true});return op;
}
async function owned(user:string,id:string){
  const wallet=await callerWallet(user);if(!wallet)throw new RequestNotFoundError();
  const doc=await findForParticipant(await getPaymentRequests(),id,wallet);if(!doc)throw new RequestNotFoundError();
  return {doc,wallet};
}
function payer(doc:PaymentRequestDoc,wallet:string){if(doc.addresseeWallet!==wallet)throw new RequestRejectedError("Only the person asked to pay can pay this request.");}
export async function beginPayment(user:string,input:{id:string;revision:number;attemptId:string}):Promise<PaymentOperation>{
  enforceRequestLimit(user,"paymentStart");
  if(!relayerConfigured())throw new RequestUnavailableError("Payment processing is unavailable. Try again shortly.");
  const {doc,wallet}=await owned(user,input.id);payer(doc,wallet);
  const pool=requestPool();if(!pool||pool.scope!==doc.scope)throw new RequestUnavailableError();
  if(doc.status!=="pending")throw new RequestConflictError();
  if(doc.operationId===input.attemptId)return project(doc);
  const requests=await getPaymentRequests();
  let revision=input.revision;
  if(doc.operationId){
    const r=doc.reservation;
    if(!r||r.phase!=="preparing"||r.currentSubmission||Date.now()-r.updatedAt.getTime()<600_000)throw new RequestConflictError("A payment is already in progress.");
    // A signed/uncertain step is never released by an elapsed timer.
    const current=await reconcileRequestOperation(doc.operationId);
    if(current?.phase!=="preparing")throw new RequestConflictError();
    const released=await requests.findOneAndUpdate({_id:doc._id,revision:doc.revision,operationId:doc.operationId,"reservation.currentSubmission":null},{$set:{operationId:null,reservation:null,updatedAt:new Date()},$inc:{revision:1}},{returnDocument:"after",includeResultMetadata:false});
    if(!released||input.revision!==doc.revision)throw new RequestConflictError();revision=released.revision;
    const {operations}=await collections();await operations.updateOne({_id:doc.operationId},{$set:{phase:"failed",updatedAt:new Date().toISOString()}});
  }
  const {operations}=await collections();const old=await operations.findOne({_id:input.attemptId});if(old)throw new RequestConflictError("Use a new payment attempt.");
  const now=new Date();const reservation:RequestReservationDoc={attemptId:input.attemptId,phase:"preparing",updatedAt:now,completedMerges:0,nextStep:0,txHash:null,relayWallet:null,currentSubmission:null,currentDigest:null};
  const reserved=await requests.findOneAndUpdate({_id:doc._id,status:"pending",revision,operationId:null,addresseeWallet:wallet},{$set:{operationId:input.attemptId,reservation,updatedAt:now},$inc:{revision:1}},{returnDocument:"after",includeResultMetadata:false});
  if(!reserved)throw new RequestConflictError();return project(reserved);
}
function intentFor(doc:PaymentRequestDoc,submission:SignedSubmission):RelayIntent{
  const pool=resolvePool(doc.scope),wallet=doc.reservation?.relayWallet;
  if(!wallet)throw new RequestUnavailableError();
  return {operationKey:`request:${submission.operationId}:${submission.step}`,chainId:pool.chainId,wallet:wallet as Hex,to:pool.address,data:encodeSubmission(submission),confirmations:pool.confirmations};
}
async function setPhase(doc:PaymentRequestDoc,phase:RequestReservationDoc["phase"],hash:string|null){
  const requests=await getPaymentRequests();
  const changed=await requests.findOneAndUpdate({_id:doc._id,operationId:doc.operationId,"reservation.nextStep":doc.reservation!.nextStep,"reservation.currentDigest":doc.reservation!.currentDigest,status:"pending"},{$set:{"reservation.phase":phase,"reservation.txHash":hash,"reservation.updatedAt":new Date(),updatedAt:new Date()}},{returnDocument:"after",includeResultMetadata:false});
  return changed??await requests.findOne({_id:doc._id});
}
async function failAttempt(doc:PaymentRequestDoc){
  const failed=await setPhase(doc,"failed",null);if(!failed?.reservation)return null;
  const result=await project(failed);
  await (await getPaymentRequests()).updateOne({_id:doc._id,operationId:doc.operationId,"reservation.phase":"failed"},{$set:{operationId:null,reservation:null,updatedAt:new Date()},$inc:{revision:1}});
  return result;
}
async function process(doc:PaymentRequestDoc,rebroadcast:boolean):Promise<PaymentOperation>{
  const body=doc.reservation?.currentSubmission;if(!body)return project(doc);
  if(doc.digest!==requestDigest(toPaymentRequest(doc)).toLowerCase()||doc.reservation?.currentDigest!==submissionDigest(body).toLowerCase()||!await verifyTypedData({address:doc.addresseeWallet as Hex,...submissionTypedData(body),signature:body.signature}))throw new RequestRejectedError("Payment evidence has changed.");
  const runtime=await runtimeSender(),intent=intentFor(doc,body),requests=await getPaymentRequests();
  let active=doc;
  try{
    const known=await runtime.journal.read(`${intent.chainId}:${intent.wallet.toLowerCase()}`,intent.operationKey);
    // Simulate only before the first signature. Once the journal owns signed
    // bytes, the input nullifier may already be spent; recover with those exact
    // bytes instead of treating a post-broadcast simulation revert as failure.
    if(!known?.serializedTransaction)await runtime.reader.call({account:runtime.account.address,to:intent.to,data:intent.data});
    const prepared=await runtime.sender.prepare(intent);
    active=(await setPhase(doc,"submitted",prepared.txHash))??doc;
    const {steps}=await collections();
    const digest=submissionDigest(body).toLowerCase(),stepId=`${body.operationId}:${body.step}`;
    await steps.updateOne({_id:stepId},{$setOnInsert:{requestId:body.requestId,operationId:body.operationId,step:body.step,digest,submission:body,txHash:prepared.txHash}},{upsert:true});
    const storedStep=await steps.findOne({_id:stepId});
    if(!storedStep||storedStep.digest.toLowerCase()!==digest)throw new RequestConflictError("A prior payment step cannot be changed.");
    const evidence=await runtime.sender.reconcile(intent);
    if(evidence.state==="unknown"){
      if(rebroadcast){try{await runtime.sender.broadcast(intent);}catch{/* Same journaled bytes are reconciled below; never sign a new attempt. */}}
      const uncertain=await setPhase(active,"needsReconciliation",prepared.txHash);return project(uncertain??active);
    }
    if(evidence.state==="reverted")return (await failAttempt(active))??wire(active);
    if(!evidence.receipt)throw new RequestConflictError();
    const tx=await runtime.reader.getTransaction({hash:prepared.txHash});
    const confirmations=Number((await runtime.reader.getBlockNumber())-evidence.receipt.blockNumber+1n);
    const verified=verifyRequestReceipt({pool:resolvePool(doc.scope),submission:body,transaction:{hash:tx.hash,to:tx.to,input:tx.input},receipt:evidence.receipt,confirmations,requestCommitment:doc.recipientCommitment as Hex});
    if(!verified.valid||verified.leafIndex===null){const uncertain=await setPhase(active,"needsReconciliation",prepared.txHash);return project(uncertain??active);}
    const final=body.kind==="payment";
    const changed=await requests.findOneAndUpdate({_id:doc._id,status:"pending",operationId:body.operationId,"reservation.nextStep":body.step,"reservation.currentDigest":submissionDigest(body).toLowerCase()},{$set:{status:final?"paid":"pending",receipt:final?{txHash:prepared.txHash,leafIndex:verified.leafIndex,block:Number(evidence.receipt.blockNumber)}:null,"reservation.phase":final?"confirmed":"preparing","reservation.txHash":final?prepared.txHash:null,"reservation.currentSubmission":null,"reservation.currentDigest":null,"reservation.updatedAt":new Date(),updatedAt:new Date()},$inc:{"reservation.nextStep":1,"reservation.completedMerges":body.kind==="merge"?1:0,revision:1}},{returnDocument:"after",includeResultMetadata:false});
    const latest=changed??await requests.findOne({_id:doc._id});if(!latest)throw new RequestNotFoundError();return project(latest);
  }catch(e){
    const saved=await runtime.journal.read(`${intent.chainId}:${intent.wallet.toLowerCase()}`,intent.operationKey);
    if(saved?.serializedTransaction||active.reservation?.txHash||e instanceof RelayBusyError){
      const pending=await setPhase(active,saved?.serializedTransaction||active.reservation?.txHash?"needsReconciliation":"preparing",saved?.txHash??active.reservation?.txHash??null);return project(pending??active);
    }
    const failed=await failAttempt(active);if(failed)return failed;throw new RequestUnavailableError("This payment could not be prepared. Refresh and try again.");
  }
}
async function submit(user:string,input:SignedSubmission,kind:"payment"|"preparation"){
  const parsed=signedSubmissionSchema.safeParse(input);if(!parsed.success)throw new RequestRejectedError();const body=parsed.data as SignedSubmission;
  if((kind==="payment")!==(body.kind==="payment"))throw new RequestRejectedError();
  encodeSubmission(body);
  if(new Set(body.nullifiers.map(v=>v.toLowerCase())).size!==body.nullifiers.length)throw new RequestRejectedError();
  const {doc,wallet}=await owned(user,body.requestId);payer(doc,wallet);
  if(doc.scope!==body.pool||doc.operationId!==body.operationId||doc.status!=="pending"||!doc.reservation)throw new RequestConflictError();
  if(body.kind==="payment"&&body.outputs[0].commitment.toLowerCase()!==doc.recipientCommitment)throw new RequestRejectedError();
  if(!await verifyTypedData({address:wallet as Hex,...submissionTypedData(body),signature:body.signature}))throw new RequestRejectedError("The payment signature is invalid.");
  const hash=submissionDigest(body).toLowerCase();
  if(doc.reservation.currentSubmission){if(doc.reservation.currentDigest!==hash)throw new RequestConflictError();return process(doc,true);}
  if(body.step!==doc.reservation.nextStep||doc.reservation.phase!=="preparing")throw new RequestConflictError();
  const relayWallet=relayerAddress();if(!relayWallet)throw new RequestUnavailableError();
  const requests=await getPaymentRequests();
  const reserved=await requests.findOneAndUpdate({_id:doc._id,status:"pending",operationId:body.operationId,"reservation.nextStep":body.step,"reservation.phase":"preparing","reservation.currentSubmission":null},{$set:{"reservation.currentSubmission":body,"reservation.currentDigest":hash,"reservation.relayWallet":relayWallet.toLowerCase(),"reservation.phase":"submitting","reservation.updatedAt":new Date()}},{returnDocument:"after",includeResultMetadata:false});
  if(!reserved)throw new RequestConflictError();return process(reserved,true);
}
export function submitPayment(user:string,body:SignedSubmission){return submit(user,body,"payment");}
export function submitConsolidation(user:string,body:SignedSubmission){return submit(user,body,"preparation");}
export async function reconcileRequestOperation(id:string):Promise<PaymentOperation|null>{
  const doc=await (await getPaymentRequests()).findOne({operationId:id});if(!doc?.reservation)return null;
  if(doc.status!=="pending"||!doc.reservation.currentSubmission)return project(doc);
  return process(doc,false);
}
export async function paymentStatus(user:string,input:{id:string}){
  enforceRequestLimit(user,"query");const {doc}=await owned(user,input.id);
  return doc.operationId?reconcileRequestOperation(doc.operationId):null;
}
export async function reconcilePendingRequests({limit}:{limit:number}){
  const rows=await (await getPaymentRequests()).find({status:"pending",operationId:{$type:"string"},"reservation.currentSubmission":{$ne:null}}).limit(Math.min(limit,20)).toArray();
  let confirmed=0,unresolved=0;
  for(const doc of rows){try{const result=await process(doc,true);if(result.phase==="confirmed")confirmed++;else unresolved++;}catch{unresolved++;}}
  return {examined:rows.length,confirmed,unresolved};
}
