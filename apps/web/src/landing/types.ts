export type LandingTheme = "light" | "dark";

export type LandingVariantProps = {
  theme: LandingTheme;
  onToggleTheme: () => void;
  onOpenApp: () => void;
  onOpenTrust: () => void;
  onOpenFeed: () => void;
  onOpenAgents: () => void;
  onOpenCounterparty?: () => void;
};
