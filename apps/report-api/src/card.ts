import {
  ACCOUNT_POLICY_VERSION,
  accountSignalsFromFacts,
  accountPolicyHash,
  hashJson,
  POLICY_VERSION,
  policyHash,
  scoreAccount,
  scoreSubject,
  subjectSignalsFromFacts
} from "@agent-pay/core";

// ------------------------------------------------------------------ //
//  VerdictCardData                                                     //
// ------------------------------------------------------------------ //

export type VerdictCardData = {
  aspect: "CLEAR" | "CAUTION" | "DANGER";
  subjectShortHash: string;
  flags: { code: string; message: string }[];
  notChecked: string[];
  decisionTxHash: string;
  policyHash: string;
};

export type VerdictCardSubmission = {
  card: VerdictCardData;
  proof: {
    hashKind: "deploy" | "transaction";
    datasetId: string;
    datasetRoot: string;
    reportHash: string;
    paymentReceiptHash: string;
    verdictReport: Record<string, unknown>;
  };
};

const CARD_ASPECTS = new Set<VerdictCardData["aspect"]>(["CLEAR", "CAUTION", "DANGER"]);
const HEX_HASH_PATTERN = /^[0-9a-f]{64}$/i;
const SUBJECT_HASH_PATTERN = /^[0-9a-f]{8,64}$/i;

function isBoundedString(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength;
}

export function parseVerdictCardData(value: unknown): VerdictCardData | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.aspect !== "string" ||
    !CARD_ASPECTS.has(candidate.aspect as VerdictCardData["aspect"]) ||
    typeof candidate.subjectShortHash !== "string" ||
    !SUBJECT_HASH_PATTERN.test(candidate.subjectShortHash) ||
    typeof candidate.decisionTxHash !== "string" ||
    !HEX_HASH_PATTERN.test(candidate.decisionTxHash) ||
    typeof candidate.policyHash !== "string" ||
    !HEX_HASH_PATTERN.test(candidate.policyHash) ||
    !Array.isArray(candidate.flags) ||
    candidate.flags.length > 20 ||
    !Array.isArray(candidate.notChecked) ||
    candidate.notChecked.length > 20
  ) {
    return null;
  }

  const flags: VerdictCardData["flags"] = [];
  for (const flag of candidate.flags) {
    if (typeof flag !== "object" || flag === null || Array.isArray(flag)) {
      return null;
    }
    const item = flag as Record<string, unknown>;
    if (!isBoundedString(item.code, 64) || !isBoundedString(item.message, 500)) {
      return null;
    }
    flags.push({ code: item.code, message: item.message });
  }

  const notChecked: string[] = [];
  for (const item of candidate.notChecked) {
    if (!isBoundedString(item, 200)) {
      return null;
    }
    notChecked.push(item);
  }

  return {
    aspect: candidate.aspect as VerdictCardData["aspect"],
    subjectShortHash: candidate.subjectShortHash,
    flags,
    notChecked,
    decisionTxHash: candidate.decisionTxHash,
    policyHash: candidate.policyHash
  };
}

export function parseVerdictCardSubmission(value: unknown): VerdictCardSubmission | null {
  const input = asRecord(value);
  const card = parseVerdictCardData(input?.card);
  const proof = asRecord(input?.proof);
  const verdictReport = asRecord(proof?.verdictReport);
  if (
    !card ||
    !proof ||
    !verdictReport ||
    (proof.hashKind !== "deploy" && proof.hashKind !== "transaction") ||
    typeof proof.datasetId !== "string" ||
    !/^[A-Za-z0-9_.:-]{1,128}$/.test(proof.datasetId) ||
    typeof proof.datasetRoot !== "string" ||
    !HEX_HASH_PATTERN.test(proof.datasetRoot) ||
    typeof proof.reportHash !== "string" ||
    !HEX_HASH_PATTERN.test(proof.reportHash) ||
    typeof proof.paymentReceiptHash !== "string" ||
    !HEX_HASH_PATTERN.test(proof.paymentReceiptHash)
  ) {
    return null;
  }

  try {
    if (hashJson(verdictReport) !== proof.reportHash.toLowerCase()) return null;
  } catch {
    return null;
  }

  const subject = asRecord(verdictReport.subject);
  const signals = asRecord(verdictReport.signals);
  const packageHash = typeof subject?.packageHash === "string"
    ? subject.packageHash.replace(/^hash-/i, "").toLowerCase()
    : "";
  if (!signals || !HEX_HASH_PATTERN.test(packageHash)) return null;

  const account = subject?.kind === "account";
  if (!account && subject?.kind !== "token") return null;
  const expectedPolicyVersion = account ? ACCOUNT_POLICY_VERSION : POLICY_VERSION;
  const expectedPolicyHash = account ? accountPolicyHash() : policyHash();
  if (
    verdictReport.policyVersion !== expectedPolicyVersion ||
    verdictReport.policyHash !== expectedPolicyHash ||
    card.policyHash !== expectedPolicyHash ||
    card.subjectShortHash.toLowerCase() !== packageHash.slice(0, 8)
  ) {
    return null;
  }

  const rule = account
    ? scoreAccount(accountSignalsFromFacts(signals))
    : scoreSubject(subjectSignalsFromFacts(signals));
  const cardFlags = rule.flags.map(({ code, message }) => ({ code, message }));
  if (
    verdictReport.aspect !== rule.aspect ||
    verdictReport.decision !== rule.decision ||
    !sameJson(verdictReport.flags, rule.flags) ||
    !sameJson(verdictReport.notChecked, rule.notChecked) ||
    card.aspect !== rule.aspect ||
    !sameJson(card.flags, cardFlags) ||
    !sameJson(card.notChecked, rule.notChecked)
  ) {
    return null;
  }

  if (
    typeof verdictReport.rationale !== "string" ||
    !verdictReport.rationale.trim() ||
    typeof verdictReport.notCheckedNote !== "string" ||
    !verdictReport.notCheckedNote.trim() ||
    (verdictReport.evidenceNetwork !== "casper-mainnet" &&
      verdictReport.evidenceNetwork !== "casper-testnet") ||
    !validPayment(asRecord(verdictReport.payment))
  ) {
    return null;
  }

  return {
    card,
    proof: {
      hashKind: proof.hashKind,
      datasetId: proof.datasetId,
      datasetRoot: proof.datasetRoot.toLowerCase(),
      reportHash: proof.reportHash.toLowerCase(),
      paymentReceiptHash: proof.paymentReceiptHash.toLowerCase(),
      verdictReport
    }
  };
}

function validPayment(payment: Record<string, unknown> | null): boolean {
  return Boolean(
    payment &&
    typeof payment.amount === "string" &&
    /^(0|[1-9][0-9]*)$/.test(payment.amount) &&
    typeof payment.amountDisplay === "string" &&
    payment.amountDisplay.length > 0 &&
    typeof payment.asset === "string" &&
    HEX_HASH_PATTERN.test(payment.asset) &&
    typeof payment.assetSymbol === "string" &&
    payment.assetSymbol.length > 0 &&
    (payment.assetDecimals === null ||
      (Number.isSafeInteger(payment.assetDecimals) &&
        (payment.assetDecimals as number) >= 0 &&
        (payment.assetDecimals as number) <= 255)) &&
    payment.network === "casper:casper-test"
  );
}

function sameJson(left: unknown, right: unknown): boolean {
  try {
    return hashJson(left) === hashJson(right);
  } catch {
    return false;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

// ------------------------------------------------------------------ //
//  Signal-box palette (hex, from apps/web/src/styles.css)            //
//  DANGER = hsl(353 74% 44%)  → #c5253b                              //
//  CAUTION = hsl(33 95% 51%)  → #f59d0b                              //
//  CLEAR = hsl(156 70% 28%)   → #156e47                              //
// ------------------------------------------------------------------ //

type AspectColors = {
  primary: string;
  soft: string;
  text: string;
};

function aspectColors(aspect: VerdictCardData["aspect"]): AspectColors {
  switch (aspect) {
    case "DANGER":
      return { primary: "#c5253b", soft: "#fdf2f3", text: "#c5253b" };
    case "CAUTION":
      return { primary: "#f59d0b", soft: "#fef7e0", text: "#b56a06" };
    case "CLEAR":
      return { primary: "#156e47", soft: "#ecfdf5", text: "#156e47" };
  }
}

// ------------------------------------------------------------------ //
//  SVG dimensions                                                     //
// ------------------------------------------------------------------ //

const WIDTH = 600;
const PAD = 32;
const MONO = "SFMono-Regular, Consolas, 'Liberation Mono', monospace";
const SANS = "Archivo, 'Helvetica Neue', 'Segoe UI', system-ui, sans-serif";

// Escape XML special characters
function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// Truncate long strings for display
function trunc(str: string, max = 48): string {
  return str.length > max ? str.slice(0, max) + "…" : str;
}

// ------------------------------------------------------------------ //
//  renderVerdictCardSvg — pure SVG string template                    //
// ------------------------------------------------------------------ //

export function renderVerdictCardSvg(data: VerdictCardData): string {
  const colors = aspectColors(data.aspect);

  // Build flag rows
  const flagRows: string[] = data.flags.map((flag, i) => {
    const y = 228 + i * 36;
    return `
    <circle cx="${PAD + 8}" cy="${y - 4}" r="4" fill="${colors.primary}" />
    <text x="${PAD + 22}" y="${y}" font-family="${escapeXml(SANS)}" font-size="13" fill="#1e293b">
      ${escapeXml(trunc(flag.message, 60))}
    </text>
    <text x="${PAD + 22}" y="${y + 14}" font-family="${escapeXml(MONO)}" font-size="10" fill="#64748b">
      ${escapeXml(flag.code)}
    </text>`;
  });

  const flagBlockHeight = Math.max(data.flags.length * 36, 36);
  const flagSectionEnd = 228 + flagBlockHeight;

  // Not-checked section
  const notCheckedY = flagSectionEnd + 20;
  const notCheckedItems = data.notChecked.length > 0 ? data.notChecked.join(", ") : "none";

  // Proven on Casper section
  const provenY = notCheckedY + 52;

  // Policy hash section
  const policyY = provenY + 52;

  // Footer
  const footerY = policyY + 52;

  // Total height
  const totalHeight = footerY + 36;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${totalHeight}" viewBox="0 0 ${WIDTH} ${totalHeight}">
  <!-- Background -->
  <rect width="${WIDTH}" height="${totalHeight}" rx="8" fill="#f8fafc" />

  <!-- Top accent bar in aspect color -->
  <rect width="${WIDTH}" height="6" rx="8" fill="${colors.primary}" />
  <rect x="0" y="3" width="${WIDTH}" height="6" rx="0" fill="${colors.primary}" />

  <!-- Header background -->
  <rect x="0" y="0" width="${WIDTH}" height="112" rx="8" fill="${colors.soft}" />
  <rect x="0" y="96" width="${WIDTH}" height="16" rx="0" fill="${colors.soft}" />

  <!-- AGENTPAY label -->
  <text x="${PAD}" y="36" font-family="${escapeXml(MONO)}" font-size="10" font-weight="700" letter-spacing="0.18em" fill="${colors.text}" opacity="0.7">
    AGENTPAY · CHECK RESULT
  </text>

  <!-- Aspect word (big) -->
  <text x="${PAD}" y="86" font-family="${escapeXml(SANS)}" font-size="48" font-weight="900" letter-spacing="0" fill="${colors.primary}">
    ${escapeXml(data.aspect)}
  </text>

  <!-- Subject short hash -->
  <text x="${WIDTH - PAD}" y="86" font-family="${escapeXml(MONO)}" font-size="13" fill="#64748b" text-anchor="end">
    subject: ${escapeXml(data.subjectShortHash)}
  </text>

  <!-- Divider -->
  <line x1="${PAD}" y1="120" x2="${WIDTH - PAD}" y2="120" stroke="#e2e8f0" stroke-width="1" />

  <!-- Flags section header -->
  <text x="${PAD}" y="148" font-family="${escapeXml(MONO)}" font-size="10" font-weight="700" letter-spacing="0.14em" fill="#94a3b8">
    FLAGS (${data.flags.length})
  </text>

  ${data.flags.length === 0
    ? `<text x="${PAD}" y="194" font-family="${escapeXml(SANS)}" font-size="13" fill="#94a3b8">No flags raised</text>`
    : flagRows.join("\n")
  }

  <!-- Divider -->
  <line x1="${PAD}" y1="${notCheckedY - 8}" x2="${WIDTH - PAD}" y2="${notCheckedY - 8}" stroke="#e2e8f0" stroke-width="1" />

  <!-- Not checked -->
  <text x="${PAD}" y="${notCheckedY + 12}" font-family="${escapeXml(MONO)}" font-size="10" font-weight="700" letter-spacing="0.14em" fill="#94a3b8">
    NOT CHECKED
  </text>
  <text x="${PAD}" y="${notCheckedY + 32}" font-family="${escapeXml(SANS)}" font-size="13" fill="#64748b">
    ${escapeXml(trunc(notCheckedItems, 70))}
  </text>

  <!-- Divider -->
  <line x1="${PAD}" y1="${provenY - 8}" x2="${WIDTH - PAD}" y2="${provenY - 8}" stroke="#e2e8f0" stroke-width="1" />

  <!-- Proven on Casper -->
  <text x="${PAD}" y="${provenY + 12}" font-family="${escapeXml(MONO)}" font-size="10" font-weight="700" letter-spacing="0.14em" fill="#156e47">
    PROVEN ON CASPER ✓
  </text>
  <text x="${PAD}" y="${provenY + 32}" font-family="${escapeXml(MONO)}" font-size="11" fill="#64748b">
    tx: ${escapeXml(data.decisionTxHash)}
  </text>

  <!-- Divider -->
  <line x1="${PAD}" y1="${policyY - 8}" x2="${WIDTH - PAD}" y2="${policyY - 8}" stroke="#e2e8f0" stroke-width="1" />

  <!-- Policy hash -->
  <text x="${PAD}" y="${policyY + 12}" font-family="${escapeXml(MONO)}" font-size="10" font-weight="700" letter-spacing="0.14em" fill="#94a3b8">
    POLICY
  </text>
  <text x="${PAD}" y="${policyY + 30}" font-family="${escapeXml(MONO)}" font-size="10" fill="#94a3b8">
    ${escapeXml(data.policyHash)}
  </text>

  <!-- Footer -->
  <rect x="0" y="${footerY - 4}" width="${WIDTH}" height="${totalHeight - footerY + 4}" rx="0" fill="#f1f5f9" />
  <rect x="0" y="${footerY - 4}" width="${WIDTH}" height="8" rx="0" fill="#f1f5f9" />
  <rect x="0" y="${totalHeight - 16}" width="${WIDTH}" height="16" rx="8" fill="#f1f5f9" />
  <text x="${WIDTH / 2}" y="${footerY + 20}" font-family="${escapeXml(SANS)}" font-size="11" fill="#94a3b8" text-anchor="middle">
    automated evidence flags, not financial advice
  </text>
</svg>`;
}

// ------------------------------------------------------------------ //
//  renderVerdictCardPng — convert SVG to PNG via @resvg/resvg-js     //
//  Falls back gracefully if resvg native binary fails to load.       //
// ------------------------------------------------------------------ //

export async function renderVerdictCardPng(svg: string): Promise<Buffer> {
  try {
    // Dynamic import so a missing native binary doesn't crash the module
    const { Resvg } = await import("@resvg/resvg-js");
    const resvg = new Resvg(svg, {
      fitTo: { mode: "width", value: 600 }
    });
    const rendered = resvg.render();
    return rendered.asPng();
  } catch {
    // resvg native binary not available — return SVG bytes as fallback
    return Buffer.from(svg, "utf8");
  }
}

// ------------------------------------------------------------------ //
//  Deterministic card id from the verdict data                        //
// ------------------------------------------------------------------ //

export function verdictCardId(data: VerdictCardData): string {
  return `card-${hashJson(data).slice(0, 32)}`;
}
