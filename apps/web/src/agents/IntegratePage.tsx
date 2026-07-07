import { ArrowLeft } from "@phosphor-icons/react";
import { AgentPayLogo } from "../components/AgentPayLogo";
import "./integrate-page.css";

const PRIMARY_TOOLS = [
  { name: "quote_report", body: "Returns price, expiry, dataset root, payment resource, and x402 requirements for a subject (token package hash or Casper account)." },
  { name: "assess_subject", body: "Runs the full rail in one call: quote, sign/pay, verify, score, narrate, record. Accepts a token package hash or a Casper account and routes to the matching policy." },
  { name: "buy_report", body: "Replays the quote with a signed PAYMENT-SIGNATURE payload and unlocks the report." },
  { name: "verify_report", body: "Checks the released report + Merkle proof against the quoted dataset root." },
  { name: "record_decision", body: "Writes approved / needs_review / rejected to the Casper registry." }
] as const;

const MCP_CONFIG = `{
  "mcpServers": {
    "agent-pay": {
      "command": "pnpm",
      "args": ["--filter", "@agent-pay/mcp-server", "stdio"],
      "env": {
        "REPORT_API_URL": "http://127.0.0.1:4021",
        "AGENT_PAY_PUBLIC_ORIGIN": "http://127.0.0.1:4021"
      }
    }
  }
}`;

const MCP_TOOL_CALL = `{ "name": "quote_report", "arguments": { "subject": "hash-<64 hex package hash>" } }`;

const HTTP_CALL = `export AGENT_PAY_BASE_URL=http://127.0.0.1:4021
curl -X POST "$AGENT_PAY_BASE_URL/tools/quote_report" \\
  -H "Content-Type: application/json" \\
  -d '{ "subject": "hash-<64 hex package hash>" }'`;

type IntegratePageProps = {
  onBack: () => void;
  onOpenAsk: () => void;
};

export default function IntegratePage({ onBack, onOpenAsk }: IntegratePageProps) {
  return (
    <main className="ag">
      <nav className="ag-nav" aria-label="Agent integration">
        <button className="ag-brand" type="button" onClick={onBack}>
          <AgentPayLogo className="ag-brand-logo" decorative />
          <span>AgentPay</span>
        </button>
        <div className="ag-navlinks">
          <button type="button" onClick={onBack}>
            <ArrowLeft size={14} weight="bold" aria-hidden="true" /> Overview
          </button>
          <button type="button" onClick={onOpenAsk}>Check a token</button>
        </div>
      </nav>

      <div className="ag-doc">
        <header className="ag-head">
          <p className="ag-kicker">MCP server</p>
          <h1>How agents talk to AgentPay</h1>
          <p className="ag-lede">
            AgentPay publishes a self-describing skill and the same evidence rail over MCP tools
            (with an HTTP bridge). Agents act with their own Casper keys, and the web UI only observes.
          </p>
        </header>

        <section className="ag-section">
          <div className="ag-section-head">
            <h2>Add the MCP server</h2>
            <code className="ag-resource">skill://agentpay</code>
          </div>
          <pre className="ag-code">
            <code>{MCP_CONFIG}</code>
          </pre>
          <p className="ag-note">
            These env values are literal strings, not shell variables. Use{" "}
            <code>http://127.0.0.1:4021</code> locally, or your deployed report-API origin.
          </p>
          <p className="ag-note">
            Or fetch the skill directly: <code>curl http://127.0.0.1:4021/skill.md</code>
          </p>
        </section>

        <section className="ag-section">
          <h2>Tools</h2>
          <dl className="ag-tools">
            {PRIMARY_TOOLS.map((tool) => (
              <div className="ag-tool" key={tool.name}>
                <dt><code>{tool.name}</code></dt>
                <dd>{tool.body}</dd>
              </div>
            ))}
          </dl>
          <p className="ag-note">
            HTTP bridge: <code>POST http://127.0.0.1:4021/tools/&lt;name&gt;</code>
            <span className="ag-sep">·</span> support: <code>payment_status</code>, <code>registry_status</code>
          </p>
        </section>

        <section className="ag-section">
          <h2>The flow</h2>
          <p className="ag-flow">
            <b>Connect → Quote → Pay → Verify → Record.</b> The buyer signs x402 with its own Casper
            key; AgentPay never holds one. A deterministic rule engine owns the verdict:{" "}
            <span className="ag-chip ag-chip--clear">CLEAR</span>
            <span className="ag-chip ag-chip--caution">CAUTION</span>
            <span className="ag-chip ag-chip--danger">DANGER</span>. Narration can explain it but never override it.
          </p>
        </section>

        <section className="ag-section">
          <h2>Quickstart</h2>
          <pre className="ag-code">
            <code>{MCP_TOOL_CALL}</code>
          </pre>
          <p className="ag-note">Over the HTTP bridge:</p>
          <pre className="ag-code">
            <code>{HTTP_CALL}</code>
          </pre>
        </section>

        <div className="ag-cta">
          <button type="button" className="ag-btn" onClick={onOpenAsk}>Check a token</button>
          <span className="ag-cta-note">Use the skill as the contract. Keep the wallet with the agent.</span>
        </div>
      </div>
    </main>
  );
}
