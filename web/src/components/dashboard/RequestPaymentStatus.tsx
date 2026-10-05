"use client";
import type {PaymentOperation,RequestStatus} from "../../features/requests/types";
const labels:Record<RequestStatus,string>={pending:"Awaiting payment",paid:"Paid",declined:"Declined",cancelled:"Cancelled"};
const phases:Partial<Record<PaymentOperation["phase"],string>>={preparing:"Preparing private balance",submitting:"Sending payment",submitted:"Confirming payment",needsReconciliation:"Confirming payment",confirmed:"Payment confirmed",failed:"Payment failed · try again"};
export function RequestPaymentStatus({status,operation,inFlight=false}:{status:RequestStatus;operation:PaymentOperation|null;inFlight?:boolean}){
  const live=status==="pending"&&(operation!==null||inFlight);
  const label=status!=="pending"?labels[status]:operation?phases[operation.phase]??labels[status]:inFlight?"Confirming payment":labels[status];
  return <p className="mt-0.5 text-xs text-(--dash-ash)" role={live?"status":undefined} aria-live={live?"polite":undefined}>{label}</p>;
}
