import type { ReactNode } from "react";
import { ArrowUpRight } from "@phosphor-icons/react";
import { AgentPayLogo } from "../components/AgentPayLogo";
import { PROOF_EDGES, PROOF_NETWORK } from "../trust/proof-evidence";
import casperLogo from "../assets/brand-logos/casper.png";
import x402Logo from "../assets/brand-logos/x402.svg";

type DeskFooterProps = {
  onOpenApp: () => void;
  onOpenTrust: () => void;
  onOpenFeed: () => void;
  onOpenAgents: () => void;
};

type EcoItem = { name: string; href: string; logo: ReactNode };

const ECO: EcoItem[] = [
  {
    name: "Casper",
    href: "https://casper.network",
    logo: <img className="lv-desk-ecologo" src={casperLogo} alt="" aria-hidden="true" />
  },
  {
    name: "x402",
    href: "https://www.x402.org",
    logo: <img className="lv-desk-ecologo lv-desk-ecologo--mono" src={x402Logo} alt="" aria-hidden="true" />
  },
  {
    name: "CSPR.cloud",
    href: "https://www.cspr.cloud",
    logo: <span className="lv-desk-ecomark" aria-hidden="true">cc</span>
  },
  {
    name: "CSPR.trade",
    href: "https://www.cspr.trade",
    logo: <span className="lv-desk-ecomark" aria-hidden="true">ct</span>
  }
];

const settlement = PROOF_EDGES.find((edge) => edge.label === "x402 settlement");
const registry = PROOF_EDGES.find((edge) => edge.label === "Trust registry");

export function DeskFooter({ onOpenApp, onOpenTrust, onOpenFeed, onOpenAgents }: DeskFooterProps) {
  return (
    <footer className="lv-desk-footer">
      <div className="lv-desk-shell lv-desk-footgrid">
        <div className="lv-desk-footbrand">
          <span className="lv-desk-brand">
            <AgentPayLogo className="lv-desk-logo" decorative />
            <span className="lv-desk-brandword">AgentPay</span>
          </span>
          <p className="lv-desk-foottag">
            An x402-paid evidence desk on Casper. Quote, settle, verify, record. You pay only
            after live Casper proof.
          </p>
        </div>

        <nav className="lv-desk-footcol" aria-label="Product">
          <p className="lv-desk-foothead">Product</p>
          <button type="button" className="lv-desk-footlink-btn" onClick={onOpenTrust}>
            Check a token
          </button>
          <button type="button" className="lv-desk-footlink-btn" onClick={onOpenFeed}>
            Recent checks
          </button>
          <button type="button" className="lv-desk-footlink-btn" onClick={onOpenAgents}>
            Agent docs
          </button>
          <button type="button" className="lv-desk-footlink-btn" onClick={onOpenApp}>
            Agent console
          </button>
        </nav>

        <nav className="lv-desk-footcol" aria-label="Proof">
          <p className="lv-desk-foothead">Proof</p>
          <a className="lv-desk-footlink-btn" href="#lv-desk-rail-sec">
            How it works
          </a>
          {settlement ? (
            <a className="lv-desk-footlink-btn" href={settlement.href} target="_blank" rel="noreferrer">
              Settlement on cspr.live
            </a>
          ) : null}
          {registry ? (
            <a className="lv-desk-footlink-btn" href={registry.href} target="_blank" rel="noreferrer">
              Registry on cspr.live
            </a>
          ) : null}
        </nav>

        <div className="lv-desk-footcol" aria-label="Ecosystem">
          <p className="lv-desk-foothead">Ecosystem</p>
          {ECO.map((item) => (
            <a
              className="lv-desk-ecorow"
              key={item.name}
              href={item.href}
              target="_blank"
              rel="noreferrer"
            >
              <span className="lv-desk-ecobadge">{item.logo}</span>
              <span className="lv-desk-econame">{item.name}</span>
              <ArrowUpRight className="lv-desk-ecoout" size={13} weight="bold" aria-hidden="true" />
            </a>
          ))}
        </div>
      </div>

      <div className="lv-desk-shell lv-desk-footbottom">
        <span>&copy; 2026 AgentPay</span>
        <span className="lv-desk-footnet">AgentPayRegistry &middot; {PROOF_NETWORK}</span>
      </div>
    </footer>
  );
}

export default DeskFooter;
