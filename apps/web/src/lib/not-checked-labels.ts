// Signal keys the scorer leaves in notChecked, mapped to readable labels.
// Shared by the console check list and the token/wallet verdict card so both
// surfaces humanize the same keys the same way.
export const NOT_CHECKED_LABELS: Record<string, string> = {
  mintBurnEnabled: "CEP-18 mint and burn setting",
  publicMintEntrypoint: "public mint entry point",
  supplyControl: "standard mint controls",
  contractAgeBlocks: "Contract age",
  holderCount: "Number of token holders",
  topHolderPct: "Top-holder concentration",
  exists: "Account existence",
  balanceMotes: "Account balance",
  associatedKeyCount: "Associated keys",
  deploymentThreshold: "Transaction approval threshold",
  keyManagementThreshold: "Key-change approval threshold"
};

export function labelForNotChecked(key: string): string {
  if (NOT_CHECKED_LABELS[key]) return NOT_CHECKED_LABELS[key];
  const spaced = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
