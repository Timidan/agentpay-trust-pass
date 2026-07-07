// Signal keys the scorer leaves in notChecked, mapped to readable labels.
// Shared by the console check list and the token/wallet verdict card so both
// surfaces humanize the same keys the same way.
export const NOT_CHECKED_LABELS: Record<string, string> = {
  mintAuthorityOpen: "Mint authority",
  supplyRenounced: "Supply control",
  contractAgeBlocks: "Contract age",
  holderCount: "Holder distribution",
  exists: "Account existence",
  balanceMotes: "Account balance",
  associatedKeyCount: "Key control"
};

export function labelForNotChecked(key: string): string {
  if (NOT_CHECKED_LABELS[key]) return NOT_CHECKED_LABELS[key];
  const spaced = key.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
