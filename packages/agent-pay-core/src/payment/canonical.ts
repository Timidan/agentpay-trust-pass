import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";

export function canonicalJson(value: unknown): string {
  return serializeCanonical(value, new Set<object>());
}

export function artifactHash(value: unknown): string {
  return bytesToHex(sha256(utf8ToBytes(canonicalJson(value))));
}

function serializeCanonical(value: unknown, ancestors: Set<object>): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);

  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw invalidCanonicalValue("non-finite numbers are not supported");
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }

  if (typeof value !== "object") {
    throw invalidCanonicalValue(`${typeof value} is not supported`);
  }

  if (ancestors.has(value)) throw invalidCanonicalValue("cyclic values are not supported");
  ancestors.add(value);

  try {
    if (Array.isArray(value)) {
      return `[${value.map((item) => serializeCanonical(item, ancestors)).join(",")}]`;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw invalidCanonicalValue("only plain objects are supported");
    }

    const record = value as Record<string, unknown>;
    const entries = Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${serializeCanonical(record[key], ancestors)}`);
    return `{${entries.join(",")}}`;
  } finally {
    ancestors.delete(value);
  }
}

function invalidCanonicalValue(reason: string): TypeError {
  return new TypeError(`Value cannot be represented as canonical JSON: ${reason}`);
}
