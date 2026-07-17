// The canonical form for a Casper package hash. Validation remains with each
// caller because some boundaries accept a prefixed value before checking size.
export function normalizePackageHash(value: string): string {
  return value.trim().toLowerCase().replace(/^hash-/, "");
}
