export function enforcePilotFeeCap(spent, providerAllocation, nextMaximumFee, ceiling) {
  if ([spent, providerAllocation, nextMaximumFee, ceiling].some(value => typeof value !== "bigint" || value < 0n)) throw new Error("Invalid fee evidence");
  if (spent + providerAllocation + nextMaximumFee > ceiling) throw new Error("Pilot fee ceiling would be exceeded");
}
export function enforcePilotScope(scope, expected) {
  if (scope.acceptedScope !== true || scope.independentReviewException !== true
    || scope.chainId !== 5042 || scope.chainId !== expected.chainId
    || scope.owner.toLowerCase() !== expected.owner.toLowerCase()
    || scope.adapter.toLowerCase() !== expected.adapter.toLowerCase()
    || scope.depositAmountUnits !== "10000" || scope.totalFeeCeilingUnits !== "300000") {
    throw new Error("Pilot authorization scope mismatch");
  }
}
export function settledFeeReservation(estimatedMaximum, reportedFee, receiptGasCost) {
  if (reportedFee === undefined) return estimatedMaximum > receiptGasCost ? estimatedMaximum : receiptGasCost;
  return reportedFee > receiptGasCost ? reportedFee : receiptGasCost;
}
