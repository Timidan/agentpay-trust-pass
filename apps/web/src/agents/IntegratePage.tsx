import { bridgeUrl, reportApiOrigin } from "../api";
import { SiteFooter, SiteNav } from "../components/SiteChrome";
import "./integrate-page.css";

const MCP_NPM_URL = "https://www.npmjs.com/package/@timidan/agentpay-mcp";
const CLI_NPM_URL = "https://www.npmjs.com/package/@timidan/agentpay-cli";

const PRIMARY_TOOLS = [
  { name: "check_x402_payment", body: "Checks a captured Casper x402 charge and payment details the wallet has not signed yet. Returns PAY, REVIEW, or BLOCK before a key signs anything." },
  { name: "verify_x402_settlement", body: "Compares the executed Casper transaction with the exact charge AgentPay approved." },
  { name: "get_payment_receipt", body: "Returns the signed policy, approval, settlement proof, service response, and Casper anchor state." },
  { name: "assess_subject", body: "Runs a paid token or account check using live Casper evidence and records the result on Testnet." },
  { name: "payment_status", body: "Shows whether the hosted Casper x402 payment path is ready before an agent starts a purchase." }
] as const;

const MCP_CONFIG = `{
  "mcpServers": {
    "agent-pay": {
      "command": "npx",
      "args": ["--yes", "@timidan/agentpay-mcp"],
      "env": {
        "AGENT_PAY_API_TOKEN": "<scoped-agent-token>"
      }
    }
  }
}`;

const CLI_SETUP = `npm install --global @timidan/agentpay-cli
agentpay agent-token issue \\
  --name my-agent \\
  --key ./testnet_secret_key.pem \\
  --json`;

const MCP_TOOL_CALL = `{
  "name": "quote_report",
  "arguments": {
    "subject": "WCSPR",
    "evidenceNetwork": "casper-testnet"
  }
}`;

const HTTP_CALL = `export AGENT_PAY_MCP_URL=${bridgeUrl}
export AGENT_PAY_MCP_TOKEN="replace-with-bridge-token"
curl -X POST "$AGENT_PAY_MCP_URL/tools/payment_status" \\
  -H "Authorization: Bearer $AGENT_PAY_MCP_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{}'`;

type IntegratePageProps = {
  onBack: () => void;
  onOpenAsk: () => void;
  navigate?: (path: string) => void;
  theme?: "light" | "dark";
  onToggleTheme?: () => void;
};

export default function IntegratePage({ onBack, onOpenAsk, navigate, theme, onToggleTheme }: IntegratePageProps) {
  const nav = navigate ?? ((path: string) => (path === "/check" ? onOpenAsk() : onBack()));
  return (
    <main className="ag">
      <SiteNav current="agents" sub="Agent integration" navigate={nav} theme={theme} onToggleTheme={onToggleTheme} />

      <div className="ag-doc">
        <header className="ag-head">
          <p className="ag-kicker">MCP server</p>
          <h1>How agents talk to AgentPay</h1>
          <p className="ag-lede">
            AgentPay publishes MCP and CLI packages. It also exposes the same payment checks through
            an authenticated HTTP bridge. Agents keep their own Casper keys.
          </p>
        </header>

        <section className="ag-section">
          <h2>Install from npm</h2>
          <p className="ag-package-line">
            <a href={MCP_NPM_URL} target="_blank" rel="noreferrer">@timidan/agentpay-mcp</a>
            <span>runs the MCP server through <code>npx</code>.</span>
          </p>
          <p className="ag-package-line">
            <a href={CLI_NPM_URL} target="_blank" rel="noreferrer">@timidan/agentpay-cli</a>
            <span>creates tokens and runs checks from a terminal.</span>
          </p>
          <p className="ag-note">Use Node.js 22 or a later version.</p>
          <pre className="ag-code ag-code--spaced">
            <code>{CLI_SETUP}</code>
          </pre>
          <p className="ag-note">
            The token is bound to the payer key. This command gives it the four scopes required for
            check, settlement, observation, and receipt operations. The key stays in the local CLI.
          </p>
        </section>

        <section className="ag-section">
          <div className="ag-section-head">
            <h2>Add the MCP server</h2>
            <code className="ag-resource">skill://agentpay</code>
          </div>
          <pre className="ag-code">
            <code>{MCP_CONFIG}</code>
          </pre>
          <p className="ag-note">
            Public status and proof tools work immediately. Add a scoped token for payment checks and
            receipts. One-call paid token or wallet checks also need a local Testnet key; the skill
            explains that optional setup.
          </p>
          <p className="ag-note">
            Or fetch the skill directly: <code>curl {reportApiOrigin}/skill.md</code>
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
            HTTP bridge: <code>POST {bridgeUrl}/tools/&lt;name&gt;</code>
            <span className="ag-sep">·</span> support: <code>payment_status</code>, <code>registry_status</code>
          </p>
        </section>

        <section className="ag-section">
          <h2>The flow</h2>
          <p className="ag-flow">
            <b>Capture → Check → Sign → Verify → Receipt.</b> AgentPay returns{" "}
            <span className="ag-chip ag-chip--clear">PAY</span>
            <span className="ag-chip ag-chip--caution">REVIEW</span>
            <span className="ag-chip ag-chip--danger">BLOCK</span> before signing. The buyer signs
            locally only after PAY; AgentPay then verifies the exact Casper settlement.
          </p>
        </section>

        <section className="ag-section">
          <h2>Run the first check</h2>
          <p className="ag-note ag-note--lead">
            Call <code>quote_report</code> first. This public call does not pay or sign anything.
          </p>
          <pre className="ag-code">
            <code>{MCP_TOOL_CALL}</code>
          </pre>
          <p className="ag-note">
            A successful result contains a quote ID, Casper x402 payment terms, and payment readiness.
            Use <code>check_x402_payment</code> before a wallet signs a real service charge.
          </p>
          <p className="ag-note">Over the HTTP bridge:</p>
          <pre className="ag-code">
            <code>{HTTP_CALL}</code>
          </pre>
          <p className="ag-note">
            The hosted bridge token is separate from a scoped AgentPay API token. The npm package
            pages include the complete input formats and expected exit codes.
          </p>
        </section>

        <div className="ag-cta">
          <button type="button" className="ag-btn" onClick={onOpenAsk}>Check a token</button>
          <span className="ag-cta-note">Use the published skill as the integration guide. The agent keeps its wallet.</span>
        </div>
      </div>

      <SiteFooter current="agents" navigate={nav} />
    </main>
  );
}
