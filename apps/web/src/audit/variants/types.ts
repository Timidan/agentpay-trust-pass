import type { ComponentType } from "react";
import type { AuditFlow } from "../useAuditFlow";

export type AuditTheme = "light" | "dark";

// The exact prop contract every variant Component must satisfy. Variant
// implementers replace ONLY files inside their own variant folder; they receive
// the live flow (from useAuditFlow) and the current theme, compose the shared
// sections, and skin them. They must not re-implement decisions/verdicts/anchor
// states — those come verbatim from `flow`.
export type AuditVariantProps = {
  flow: AuditFlow;
  theme: AuditTheme;
};

export type AuditVariant = {
  id: string;
  name: string;
  Component: ComponentType<AuditVariantProps>;
};
