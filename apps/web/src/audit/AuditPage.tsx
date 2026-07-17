import { useAuditFlow } from "./useAuditFlow";
import { SiteFooter, SiteNav } from "../components/SiteChrome";
import ModernVariant from "./variants/modern";
import type { AuditTheme } from "./variants/types";
import "./audit-base.css";

// The canonical audit surface ("AgentPay Modern"). The exploration-era variant
// switcher is gone; the flow mounts once and the one UI renders it.
export default function AuditPage({
  theme,
  navigate,
}: {
  theme: AuditTheme;
  navigate?: (path: string) => void;
}) {
  const flow = useAuditFlow();
  return (
    <div className="audit-page" data-theme={theme}>
      <SiteNav current="audit" sub="Payment checker" navigate={navigate} />
      <ModernVariant flow={flow} theme={theme} />
      <SiteFooter current="audit" navigate={navigate} />
    </div>
  );
}
