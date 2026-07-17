import type * as React from "react";

export function IconProbe({ size = 40, ...rest }: { size?: number } & React.SVGProps<SVGSVGElement>) {
  return (
    <svg {...rest} aria-hidden="true" width={size} height={size} viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <path pathLength={100} className="tl-stroke" d="M7 5h20l8 8v13M7 5v38h28v-4" />
      <polyline pathLength={100} className="tl-stroke" points="27 5 27 13 35 13" />
      <path pathLength={100} className="tl-stroke" d="M13 22c2.2-3.6 4.4 3.6 6.6 0s4.4 3.6 6.6 0" />
      <circle pathLength={100} className="tl-stroke" cx="33" cy="31" r="6" />
      <line pathLength={100} className="tl-stroke" x1="37.5" y1="35.5" x2="43" y2="41" />
    </svg>
  );
}

export function IconCheck({ size = 40, ...rest }: { size?: number } & React.SVGProps<SVGSVGElement>) {
  return (
    <svg {...rest} aria-hidden="true" width={size} height={size} viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <rect pathLength={100} className="tl-stroke" x="5" y="7" width="38" height="34" rx="2" />
      <polyline pathLength={100} className="tl-stroke" points="12 17 15 20 20 14" />
      <line pathLength={100} className="tl-stroke" x1="24" y1="17" x2="36" y2="17" />
      <path pathLength={100} className="tl-stroke" d="M15 32a9 9 0 0 1 18 0" />
      <line pathLength={100} className="tl-stroke" x1="24" y1="32" x2="29" y2="24" />
      <circle pathLength={100} className="tl-stroke" cx="24" cy="32" r="1.5" />
    </svg>
  );
}

export function IconDecision({ size = 40, ...rest }: { size?: number } & React.SVGProps<SVGSVGElement>) {
  return (
    <svg {...rest} aria-hidden="true" width={size} height={size} viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <line pathLength={100} className="tl-stroke" x1="5" y1="24" x2="17" y2="24" />
      <circle pathLength={100} className="tl-stroke" cx="18" cy="24" r="1.5" />
      <polyline pathLength={100} className="tl-stroke" points="19.5 23 27 12 39 12" />
      <line pathLength={100} className="tl-stroke" x1="19.5" y1="24" x2="38" y2="24" />
      <polyline pathLength={100} className="tl-stroke" points="19.5 25 27 36 39 36" />
      <circle pathLength={100} className="tl-stroke" cx="41" cy="24" r="3" />
      <line pathLength={100} className="tl-stroke" x1="39" y1="9.5" x2="39" y2="14.5" />
      <line pathLength={100} className="tl-stroke" x1="39" y1="33.5" x2="39" y2="38.5" />
    </svg>
  );
}

export function IconSignLocally({ size = 40, ...rest }: { size?: number } & React.SVGProps<SVGSVGElement>) {
  return (
    <svg {...rest} aria-hidden="true" width={size} height={size} viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <path pathLength={100} className="tl-stroke" d="M6 20 24 6l18 14v22H6Z" />
      <polyline pathLength={100} className="tl-stroke" points="14 17 14 12 20 12" />
      <circle pathLength={100} className="tl-stroke" cx="17" cy="28" r="4" />
      <line pathLength={100} className="tl-stroke" x1="21" y1="28" x2="34" y2="28" />
      <polyline pathLength={100} className="tl-stroke" points="29 28 29 32 33 32 33 28" />
    </svg>
  );
}

export function IconSettle({ size = 40, ...rest }: { size?: number } & React.SVGProps<SVGSVGElement>) {
  return (
    <svg {...rest} aria-hidden="true" width={size} height={size} viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <rect pathLength={100} className="tl-stroke" x="5" y="10" width="12" height="28" rx="1" />
      <line pathLength={100} className="tl-stroke" x1="9" y1="10" x2="9" y2="38" />
      <line pathLength={100} className="tl-stroke" x1="12" y1="17" x2="15" y2="17" />
      <rect pathLength={100} className="tl-stroke" x="31" y="10" width="12" height="28" rx="1" />
      <line pathLength={100} className="tl-stroke" x1="35" y1="10" x2="35" y2="38" />
      <line pathLength={100} className="tl-stroke" x1="38" y1="31" x2="41" y2="31" />
      <line pathLength={100} className="tl-stroke" x1="18" y1="24" x2="30" y2="24" />
      <polyline pathLength={100} className="tl-stroke" points="26 20 30 24 26 28" />
    </svg>
  );
}

export function IconVerify({ size = 40, ...rest }: { size?: number } & React.SVGProps<SVGSVGElement>) {
  return (
    <svg {...rest} aria-hidden="true" width={size} height={size} viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      {/* one document, its twin suggested behind it, and a clear check seal */}
      <rect pathLength={100} className="tl-stroke" x="8" y="10" width="21" height="28" rx="2" />
      <path pathLength={100} className="tl-stroke" d="M14 6h17a3 3 0 0 1 3 3v19" />
      <line pathLength={100} className="tl-stroke" x1="13" y1="18" x2="24" y2="18" />
      <line pathLength={100} className="tl-stroke" x1="13" y1="24" x2="24" y2="24" />
      <circle pathLength={100} className="tl-stroke" cx="34" cy="34" r="7" />
      <polyline pathLength={100} className="tl-stroke" points="30.5 34 33 36.5 37.5 31.5" />
    </svg>
  );
}

export function IconObserve({ size = 40, ...rest }: { size?: number } & React.SVGProps<SVGSVGElement>) {
  return (
    <svg {...rest} aria-hidden="true" width={size} height={size} viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <polyline pathLength={100} className="tl-stroke" points="9 5 5 5 5 43 9 43" />
      <polyline pathLength={100} className="tl-stroke" points="39 5 43 5 43 43 39 43" />
      <path pathLength={100} className="tl-stroke" d="M11 16c3.5-5 7.8-7.5 13-7.5S33.5 11 37 16c-3.5 5-7.8 7.5-13 7.5S14.5 21 11 16Z" />
      <circle pathLength={100} className="tl-stroke" cx="24" cy="16" r="3.5" />
      <line pathLength={100} className="tl-stroke" x1="12" y1="29" x2="36" y2="29" />
      <line pathLength={100} className="tl-stroke" x1="12" y1="35" x2="30" y2="35" />
      <line pathLength={100} className="tl-stroke" x1="12" y1="41" x2="24" y2="41" />
    </svg>
  );
}

export function IconReceiptAnchored({ size = 40, ...rest }: { size?: number } & React.SVGProps<SVGSVGElement>) {
  return (
    <svg {...rest} aria-hidden="true" width={size} height={size} viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <path pathLength={100} className="tl-stroke" d="M9 4h30v28l-4-2-4 2-4-2-3 1.5L21 30l-4 2-4-2-4 2Z" />
      <line pathLength={100} className="tl-stroke" x1="15" y1="11" x2="33" y2="11" />
      <line pathLength={100} className="tl-stroke" x1="15" y1="17" x2="33" y2="17" />
      <line pathLength={100} className="tl-stroke" x1="15" y1="23" x2="27" y2="23" />
      <circle pathLength={100} className="tl-stroke" cx="24" cy="33" r="2" />
      <line pathLength={100} className="tl-stroke" x1="24" y1="35" x2="24" y2="44" />
      <line pathLength={100} className="tl-stroke" x1="19" y1="38" x2="29" y2="38" />
      <path pathLength={100} className="tl-stroke" d="M15 39c1 3.4 4 5 9 5s8-1.6 9-5" />
      <polyline pathLength={100} className="tl-stroke" points="15 39 15 43 19 41" />
      <polyline pathLength={100} className="tl-stroke" points="33 39 33 43 29 41" />
    </svg>
  );
}

export const TIMELINE_ICONS = [
  { key: "probe", Icon: IconProbe },
  { key: "check", Icon: IconCheck },
  { key: "decision", Icon: IconDecision },
  { key: "sign-locally", Icon: IconSignLocally },
  { key: "settle", Icon: IconSettle },
  { key: "verify", Icon: IconVerify },
  { key: "observe", Icon: IconObserve },
  { key: "receipt-anchored", Icon: IconReceiptAnchored },
] as const;

// One icon per narrative phase (see PHASES in data.ts).
export const PHASE_ICONS = [
  { key: "check", Icon: IconProbe },
  { key: "sign-settle", Icon: IconSignLocally },
  { key: "verify", Icon: IconVerify },
  { key: "receipt", Icon: IconReceiptAnchored },
] as const;
