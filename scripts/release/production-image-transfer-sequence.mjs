import { assertDigest } from "./contract.mjs";
import { ProductionRolloutError } from "./production-rollout-contract.mjs";

export function assertImageTransferClaimReceipt(raw, authorization) {
  let receipt;
  try {
    receipt = JSON.parse(String(raw ?? "").trim());
    const expectedKeys = [
      "action",
      "authorizationId",
      "entryDigest",
      "phase",
      "status",
    ];
    if (
      !receipt ||
      typeof receipt !== "object" ||
      Array.isArray(receipt) ||
      Object.keys(receipt).sort().join("\0") !== expectedKeys.sort().join("\0") ||
      receipt.status !== "claimed" ||
      receipt.authorizationId !== authorization.authorizationId ||
      receipt.action !== "image-transfer" ||
      receipt.phase !== 0
    ) {
      throw new Error("invalid claim receipt");
    }
    assertDigest(receipt.entryDigest, "entryDigest");
    return receipt;
  } catch {
    throw new ProductionRolloutError(
      "PRODUCTION_ROLLOUT_STATE_UNKNOWN",
      "Production image transfer Authorization claim receipt is invalid.",
    );
  }
}

export async function executeAuthorizedImageTransfer({
  authorization,
  claimAuthorization,
  createRemoteDirectory,
  transferArchives,
  loadAndVerifyImages,
}) {
  const receipt = assertImageTransferClaimReceipt(
    await claimAuthorization(),
    authorization,
  );
  await createRemoteDirectory();
  await transferArchives();
  await loadAndVerifyImages();
  return receipt;
}
