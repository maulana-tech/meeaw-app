"use client";
import type {PaymentOperation,RequestStatus} from "../../features/requests/types";
const labels:Record<RequestStatus,string>={pending:"Awaiting payment",paid:"Paid",declined:"Declined",cancelled:"Cancelled"};
const phases:Partial<Record<PaymentOperation["phase"],string>>={preparing:"Preparing private balance",submitting:"Preparing payment",submitted:"Payment is being checked",needsReconciliation:"Checking secure payment",confirmed:"Payment confirmed",failed:"Try payment again"};
export function RequestPaymentStatus({status,operation}:{status:RequestStatus;operation:PaymentOperation|null}){
  const label=status==="pending"&&operation?phases[operation.phase]??labels[status]:labels[status];
  return <p className="mt-1 text-xs text-muted-foreground" role={operation&&status==="pending"?"status":undefined} aria-live={operation&&status==="pending"?"polite":undefined}>{label}</p>;
}
