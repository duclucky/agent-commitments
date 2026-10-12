export interface ProviderResult { readonly accepted: boolean; readonly outputHash: string }
export interface PaidProvider {
  execute(operationId: string, inputHash?: string): Promise<ProviderResult>;
  settle(operationId: string): Promise<void>;
  refund(operationId: string): Promise<void>;
}

export interface WorkflowResult {
  readonly status: "COMPLETED" | "PARTIAL" | "REJECTED";
  readonly acceptedOutputs: readonly string[];
}

export async function runDocumentWorkflow(documentId: string, ocr: PaidProvider, formatter: PaidProvider): Promise<WorkflowResult> {
  const acceptedOutputs: string[] = [];
  const ocrOperation = `${documentId}:ocr`;
  const ocrResult = await ocr.execute(ocrOperation);
  if (!ocrResult.accepted) {
    await ocr.refund(ocrOperation);
    return { status: "REJECTED", acceptedOutputs };
  }
  await ocr.settle(ocrOperation);
  acceptedOutputs.push(ocrResult.outputHash);

  const formatOperation = `${documentId}:format`;
  const formatResult = await formatter.execute(formatOperation, ocrResult.outputHash);
  if (!formatResult.accepted) {
    await formatter.refund(formatOperation);
    return { status: "PARTIAL", acceptedOutputs };
  }
  await formatter.settle(formatOperation);
  acceptedOutputs.push(formatResult.outputHash);
  return { status: "COMPLETED", acceptedOutputs };
}
