export function canConfirmLegalDocuments(
  versions: readonly string[],
  confirmed: readonly string[],
): boolean {
  return (
    versions.length > 0 &&
    versions.every((version) => confirmed.includes(version))
  );
}

type SavedLegalAcceptance = {
  accepted: boolean;
  productCode: string;
  identitySourceId: string;
  legalAcceptanceId: string;
  acceptedDocuments: { documentVersionId: string; contentHash: string }[];
};

export function canReuseLegalAcceptance(
  saved: unknown,
  required: {
    productCode: string;
    identitySourceId: string;
    documents: readonly { documentVersionId: string; contentHash: string }[];
  },
): boolean {
  if (!saved || typeof saved !== "object") return false;
  const acceptance = saved as Partial<SavedLegalAcceptance>;
  return (
    acceptance.accepted === true &&
    acceptance.productCode === required.productCode &&
    acceptance.identitySourceId === required.identitySourceId &&
    typeof acceptance.legalAcceptanceId === "string" &&
    required.documents.length > 0 &&
    Array.isArray(acceptance.acceptedDocuments) &&
    acceptance.acceptedDocuments.length === required.documents.length &&
    required.documents.every((document) =>
      acceptance.acceptedDocuments!.some(
        (accepted) =>
          accepted?.documentVersionId === document.documentVersionId &&
          accepted.contentHash === document.contentHash,
      ),
    )
  );
}
