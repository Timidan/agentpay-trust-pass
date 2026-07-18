import { useEffect, useState } from "react";
import { friendlyError } from "../lib/friendly-errors";
import type { Verdict } from "../api";

// The state machine shared by the token check (AskPage) and the wallet check
// (CounterpartyPage): idle → loading → (done | error), plus an elapsed-seconds
// clock while a paid check settles. Validation and the optional resolve stage
// stay in each page; this hook owns the transitions so they can't drift.
//
// TStage names any intermediate loading phases a caller wants to surface (the
// token check runs "resolving" then "checking"; the wallet check has none).
export type TrustCheckState<TStage extends string = never> =
  | { status: "idle" }
  | { status: "loading"; stage?: TStage }
  | { status: "done"; verdict: Verdict }
  | { status: "error"; message: string; detail?: string };

export type TrustCheck<TStage extends string = never> = {
  state: TrustCheckState<TStage>;
  elapsed: number;
  isLoading: boolean;
  /** Enter the loading state, optionally at a named stage. */
  begin: (stage?: TStage) => void;
  /** Advance to a later loading stage without leaving loading. */
  setStage: (stage: TStage) => void;
  /** Resolve with a verdict. */
  succeed: (verdict: Verdict) => void;
  /** Fail with an explicit message the caller composed (e.g. "not listed"). */
  fail: (message: string, detail?: string) => void;
  /** Fail from a thrown error, mapped through friendlyError. */
  failFrom: (error: unknown) => void;
  /** Return to idle (the "check another" reset). */
  reset: () => void;
};

export function useTrustCheck<TStage extends string = never>(): TrustCheck<TStage> {
  const [state, setState] = useState<TrustCheckState<TStage>>({ status: "idle" });
  const [elapsed, setElapsed] = useState(0);
  const isLoading = state.status === "loading";

  useEffect(() => {
    if (!isLoading) {
      setElapsed(0);
      return;
    }
    const startedAt = Date.now();
    const id = window.setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => window.clearInterval(id);
  }, [isLoading]);

  return {
    state,
    elapsed,
    isLoading,
    begin: (stage?: TStage) => setState({ status: "loading", stage }),
    setStage: (stage: TStage) => setState({ status: "loading", stage }),
    succeed: (verdict: Verdict) => setState({ status: "done", verdict }),
    fail: (message: string, detail?: string) => setState({ status: "error", message, detail }),
    failFrom: (error: unknown) => {
      const friendly = friendlyError(error);
      setState({ status: "error", message: friendly.headline, detail: friendly.detail });
    },
    reset: () => setState({ status: "idle" })
  };
}
