/**
 * Verdict narrator — translates a deterministic rule-engine verdict into
 * human-readable prose.
 *
 * Three modes (in priority order):
 *   1. `deps.complete` injected → LLM path (with contradiction guard)
 *   2. `ANTHROPIC_API_KEY` present → real SDK (lazy import, try/catch)
 *   3. Deterministic template fallback (always available)
 */

type Flag = { code: string; severity: string; message: string };

type NarratorInput = {
  aspect: string;
  flags: Flag[];
  notChecked: string[];
  signals: Record<string, unknown>;
};

type NarratorDeps = {
  complete?: (prompt: string) => Promise<string>;
};

type NarratorOutput = {
  rationale: string;
  notCheckedNote: string;
};

/** The set of recognised aspect keywords for contradiction detection. */
const ASPECT_KEYWORDS = ["CLEAR", "CAUTION", "DANGER"] as const;

// ---------------------------------------------------------------------------
// Deterministic template helpers
// ---------------------------------------------------------------------------

function buildRationale(aspect: string, flags: Flag[]): string {
  if (flags.length === 0) {
    if (aspect === "CLEAR") {
      return "All checked signals are clear — no issues detected.";
    }
    return `Verdict is ${aspect} — no specific flags were recorded.`;
  }
  const messages = flags.map((f) => f.message).join("; ");
  return `This address raises concerns: ${messages}.`;
}

function buildNotCheckedNote(notChecked: string[]): string {
  if (notChecked.length === 0) {
    return "All items in the mandatory check set were verified.";
  }
  return `Not checked: ${notChecked.join(", ")}.`;
}

// ---------------------------------------------------------------------------
// Contradiction guard
// ---------------------------------------------------------------------------

/**
 * Returns true if `text` contains an aspect keyword that contradicts `aspect`.
 * e.g. if aspect is "DANGER" and text contains "CLEAR", that's a contradiction.
 */
function hasContradiction(text: string, aspect: string): boolean {
  for (const keyword of ASPECT_KEYWORDS) {
    if (keyword !== aspect && text.includes(keyword)) {
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// LLM prompt builder
// ---------------------------------------------------------------------------

function buildPrompt(input: NarratorInput): string {
  const flagLines =
    input.flags.length > 0
      ? input.flags
          .map((f) => `  - [${f.severity}] ${f.code}: ${f.message}`)
          .join("\n")
      : "  (none)";

  const notCheckedLine =
    input.notChecked.length > 0
      ? input.notChecked.join(", ")
      : "(all items verified)";

  return [
    "IMPORTANT: You MUST NOT change, question, or contradict the verdict below.",
    "Your only job is to explain it in plain English to a non-technical user.",
    "",
    `Verdict aspect: ${input.aspect}`,
    "",
    "Flags raised by the rule engine:",
    flagLines,
    "",
    `Items not checked: ${notCheckedLine}`,
    "",
    "Write 1-3 sentences explaining what this verdict means and why these flags matter.",
    "Do not include any verdict keyword (CLEAR / CAUTION / DANGER) that contradicts",
    `the verdict aspect "${input.aspect}".`,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function narrateVerdict(
  input: NarratorInput,
  deps?: NarratorDeps
): Promise<NarratorOutput> {
  const deterministicRationale = buildRationale(input.aspect, input.flags);
  const notCheckedNote = buildNotCheckedNote(input.notChecked);

  // Resolve the complete function: injected dep > SDK > undefined
  let completeFn = deps?.complete;

  if (!completeFn && process.env.ANTHROPIC_API_KEY) {
    try {
      // Lazy import so absence of the package never breaks the build or tests
      const sdk = await import("@anthropic-ai/sdk");
      const client = new sdk.default();
      completeFn = async (prompt: string) => {
        const msg = await client.messages.create({
          model: "claude-3-haiku-20240307",
          max_tokens: 256,
          messages: [{ role: "user", content: prompt }],
        });
        const block = msg.content[0];
        if (block.type !== "text") return "";
        return block.text;
      };
    } catch (err) {
      console.warn("[narrator] @anthropic-ai/sdk unavailable or failed to initialise — using deterministic fallback:", err);
    }
  }

  if (completeFn) {
    try {
      const prompt = buildPrompt(input);
      const output = await completeFn(prompt);

      if (!output || output.trim() === "") {
        // Empty output — discard, use fallback
        return { rationale: deterministicRationale, notCheckedNote };
      }

      if (hasContradiction(output, input.aspect)) {
        // Contradicting output — discard, use fallback
        return { rationale: deterministicRationale, notCheckedNote };
      }

      return { rationale: output, notCheckedNote };
    } catch {
      // LLM call failed — fall through to deterministic template
    }
  }

  return { rationale: deterministicRationale, notCheckedNote };
}
