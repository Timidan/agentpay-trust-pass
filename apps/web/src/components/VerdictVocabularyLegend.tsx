import "./verdict-vocabulary-legend.css";

const chargeTerms = ["PAY", "REVIEW", "BLOCK"] as const;
const evidenceTerms = ["CLEAR", "CAUTION", "DANGER"] as const;

export function VerdictVocabularyLegend({ className }: { className?: string }) {
  return (
    <aside
      aria-label="Verdict vocabulary"
      className={["verdict-vocabulary", className].filter(Boolean).join(" ")}
    >
      <p>
        <strong>Charge decisions:</strong>{" "}
        <VocabularyTerms terms={chargeTerms} />
        {" tell you whether this exact x402 charge may be signed."}
      </p>
      <p>
        <strong>Evidence verdicts:</strong>{" "}
        <VocabularyTerms terms={evidenceTerms} />
        {" tell you what the paid Casper evidence says about this subject."}
      </p>
    </aside>
  );
}

function VocabularyTerms({ terms }: { terms: readonly [string, string, string] }) {
  return (
    <>
      {terms.map((term, index) => (
        <span key={term}>
          {index > 0 ? " / " : null}
          <span className={`verdict-vocabulary-term is-${term.toLowerCase()}`}>{term}</span>
        </span>
      ))}
    </>
  );
}
