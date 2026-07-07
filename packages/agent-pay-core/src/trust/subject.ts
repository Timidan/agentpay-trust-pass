export type SubjectKind = "token" | "pair" | "account";

export type SubjectRef = {
  kind: SubjectKind;
  /** The identifier used as the quote key / dataset id. Token package hash (hex)
   *  for tokens; account-hash hex or public-key hex for accounts. */
  packageHash: string;
  /** Account-hash hex, when the subject is an account addressed by account hash. */
  accountId?: string;
  /** Public-key hex, when the subject is an account addressed by public key. */
  publicKey?: string;
  raw: string;
};

export type ParseSubjectResult =
  | { ok: true; subject: SubjectRef }
  | { ok: false; error: string };

const TOKEN_HEX64 = /^(hash-)?([0-9a-f]{64})$/i;
const ACCOUNT_HASH = /^account-hash-([0-9a-f]{64})$/i;
// ed25519 (01 + 64 hex) or secp256k1 (02 + 66 hex) public keys.
const PUBLIC_KEY = /^(01[0-9a-f]{64}|02[0-9a-f]{66})$/i;

export function parseSubject(input: string): ParseSubjectResult {
  const raw = (input ?? "").trim();
  if (!raw) return { ok: false, error: "empty_subject" };

  // Accounts must be explicitly disambiguated from token package hashes:
  // an `account-hash-` prefix, or a public-key hex (01…/02…).
  const acctHash = raw.match(ACCOUNT_HASH);
  if (acctHash) {
    const hex = acctHash[1].toLowerCase();
    return { ok: true, subject: { kind: "account", packageHash: hex, accountId: hex, raw } };
  }
  if (PUBLIC_KEY.test(raw)) {
    const key = raw.toLowerCase();
    return { ok: true, subject: { kind: "account", packageHash: key, publicKey: key, raw } };
  }

  const token = raw.match(TOKEN_HEX64);
  if (token) {
    return { ok: true, subject: { kind: "token", packageHash: token[2].toLowerCase(), raw } };
  }
  return { ok: false, error: "subject_must_be_casper_package_hash_or_account" };
}
