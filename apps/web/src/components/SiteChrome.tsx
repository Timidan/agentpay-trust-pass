import type { MouseEvent, ReactNode } from "react";
import { ArrowSquareOut, Moon, Sun } from "@phosphor-icons/react";
import { AgentPayLogo } from "./AgentPayLogo";
import { EXPLORER } from "../landing2/data";

// Shared page chrome for every routed page except the landing (the landing is
// the brand surface and keeps its own nav and footer). One nav, one footer,
// the same links everywhere, so no page is a dead end.

export type SiteKey = "overview" | "audit" | "check" | "counterparty" | "feed" | "agents" | "app";

type Navigate = (path: string) => void;

const LINKS: ReadonlyArray<{ key: SiteKey; label: string; path: string }> = [
  { key: "overview", label: "Overview", path: "/" },
  { key: "audit", label: "Payment checker", path: "/audit" },
  { key: "check", label: "Token check", path: "/check" },
  { key: "counterparty", label: "Wallet check", path: "/counterparty" },
  { key: "feed", label: "Shared results", path: "/feed" },
  { key: "agents", label: "Agents", path: "/agents" },
  { key: "app", label: "Console", path: "/app" },
];

// Plain anchors so pages still render outside a router (tests, embeds); with a
// navigate callback the click stays an SPA transition.
function linkClick(path: string, navigate?: Navigate) {
  return (event: MouseEvent<HTMLAnchorElement>) => {
    if (!navigate) return;
    event.preventDefault();
    navigate(path);
  };
}

export function SiteNavLinks({ current, navigate }: { current: SiteKey; navigate?: Navigate }) {
  return (
    <nav className="site-links" aria-label="AgentPay pages">
      {LINKS.map((link) => (
        <a
          key={link.key}
          href={link.path}
          aria-current={link.key === current ? "page" : undefined}
          onClick={linkClick(link.path, navigate)}
        >
          {link.label}
        </a>
      ))}
    </nav>
  );
}

export function SiteNav({
  current,
  sub,
  navigate,
  theme,
  onToggleTheme,
  actions,
}: {
  current: SiteKey;
  sub: string;
  navigate?: Navigate;
  theme?: "light" | "dark";
  onToggleTheme?: () => void;
  actions?: ReactNode;
}) {
  return (
    <header className="site-nav">
      <a className="site-brand" href="/" onClick={linkClick("/", navigate)} aria-label="AgentPay overview">
        <AgentPayLogo className="site-brand-logo" decorative />
        <span className="site-brand-copy">
          <span className="site-brand-name">AgentPay</span>
          <span className="site-brand-sub">{sub}</span>
        </span>
      </a>
      <SiteNavLinks current={current} navigate={navigate} />
      {onToggleTheme || actions ? (
        <div className="site-nav-actions">
          {onToggleTheme ? (
            <button
              type="button"
              className="site-theme"
              aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              onClick={onToggleTheme}
            >
              {theme === "dark" ? (
                <Sun size={16} weight="bold" aria-hidden="true" />
              ) : (
                <Moon size={16} weight="bold" aria-hidden="true" />
              )}
            </button>
          ) : null}
          {actions}
        </div>
      ) : null}
    </header>
  );
}

export function SiteFooter({ current, navigate }: { current: SiteKey; navigate?: Navigate }) {
  return (
    <footer className="site-footer">
      <div className="site-footer-inner">
        <div className="site-footer-brand">
          <span className="site-footer-name">AgentPay</span>
          <span className="site-footer-line">Checks the charge before your agent signs it.</span>
        </div>
        <nav className="site-footer-links" aria-label="AgentPay pages, footer">
          {LINKS.filter((link) => link.key !== "overview").map((link) => (
            <a
              key={link.key}
              href={link.path}
              aria-current={link.key === current ? "page" : undefined}
              onClick={linkClick(link.path, navigate)}
            >
              {link.label}
            </a>
          ))}
          <a href={EXPLORER} target="_blank" rel="noreferrer">
            Casper Testnet explorer
            <ArrowSquareOut size={12} weight="bold" aria-hidden="true" />
          </a>
        </nav>
      </div>
      <div className="site-footer-base">
        <span>Casper Testnet · non-custodial</span>
        <span>Approval is not payment. Signing stays in the wallet.</span>
      </div>
    </footer>
  );
}
