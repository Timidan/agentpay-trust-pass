import agentPayLogo from "../assets/agentpay-logo.png";

type AgentPayLogoProps = {
  className?: string;
  decorative?: boolean;
  variant?: "icon" | "full";
};

export function AgentPayLogo({ className = "", decorative = false, variant = "icon" }: AgentPayLogoProps) {
  return (
    <span className={`agent-pay-logo ${variant} ${className}`}>
      <img
        alt={decorative ? "" : "AgentPay logo"}
        aria-hidden={decorative ? true : undefined}
        draggable={false}
        src={agentPayLogo}
      />
      {variant === "full" ? <span className="agent-pay-logo-word">AgentPay</span> : null}
    </span>
  );
}
