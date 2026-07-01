export type SubjectRef = { kind: "token" | "pair"; packageHash: string; raw: string };
export type ParseSubjectResult =
  | { ok: true; subject: SubjectRef }
  | { ok: false; error: string };

const HEX64 = /^(hash-)?([0-9a-f]{64})$/i;

export function parseSubject(input: string): ParseSubjectResult {
  const raw = (input ?? "").trim();
  if (!raw) return { ok: false, error: "empty_subject" };
  const match = raw.match(HEX64);
  if (!match) return { ok: false, error: "subject_must_be_casper_package_hash" };
  return { ok: true, subject: { kind: "token", packageHash: match[2].toLowerCase(), raw } };
}
