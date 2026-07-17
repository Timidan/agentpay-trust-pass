import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AuditApiClient,
  AuditApiError,
  paymentRequiredFromTerms,
  type CheckPaymentResult,
  type AgentPayServiceQuote,
  type ObservationResult,
  type OperatorPolicy,
  type PaymentCheck,
  type PaymentReceiptRecord,
  type ProbeInput,
  type ProbeResult,
  type ProviderDecision,
  type ResponseObservationInput,
  type VerifySettlementResult
} from "./api";
import type {
  AuthorizationIntent,
  PaymentVerdict,
  PurchaseReceipt,
  SettlementVerdict
} from "../../../../packages/agent-pay-core/src/payment/types";
import { createWalletSession, signWalletAuthorization } from "./casperWallet";
import { createPaymentDraft } from "./paymentDraft";
import {
  submitCheckedWalletPayment,
  type CheckedWalletPaymentResult
} from "./walletPayment";
import {
  saveAssetPolicyWithWallet,
  saveProviderRuleWithWallet
} from "./walletOperatorActions";

// The hook owns the whole workflow. It re-implements NO decision logic: every
// verdict, settlement verdict and anchor state is read verbatim from the API.

export type StepStatus = "idle" | "running" | "success" | "error";

export type AuditStepState<T> = {
  status: StepStatus;
  data: T | null;
  error: AuditApiError | null;
};

// Anchor polling lifecycle, kept distinct from the request status so a pending
// anchor never reads as a settled receipt.
export type AnchorPollStatus = "idle" | "polling" | "terminal" | "error";

export type ReceiptStepState = {
  status: StepStatus;
  data: PaymentReceiptRecord | null;
  error: AuditApiError | null;
  anchorPoll: AnchorPollStatus;
  attempts: number;
};

export type AuditFlow = {
  // Auth: memory-only bearer token (operator session or agent token). Never
  // persisted to localStorage, URLs, or logs.
  tokenPresent: boolean;
  setToken: (token: string) => void;
  walletSession: AuditStepState<{ publicKey: string; expiresAt: string }>;
  connectWallet: () => Promise<void>;

  // Draft inputs.
  probeInput: ProbeInput;
  setProbeInput: (patch: Partial<ProbeInput>) => void;
  authorizationText: string;
  setAuthorizationText: (value: string) => void;
  authorization: AuditStepState<AuthorizationIntent>;

  // Steps.
  probe: AuditStepState<ProbeResult>;
  check: AuditStepState<CheckPaymentResult>;
  settlement: AuditStepState<VerifySettlementResult>;
  observation: AuditStepState<ObservationResult>;
  receipt: ReceiptStepState;
  providerDecisions: AuditStepState<ProviderDecision[]>;
  providerAction: AuditStepState<ProviderDecision>;
  policy: AuditStepState<OperatorPolicy>;
  policyAction: AuditStepState<OperatorPolicy>;
  liveService: AuditStepState<AgentPayServiceQuote>;
  walletPayment: AuditStepState<CheckedWalletPaymentResult>;

  // REVIEW re-checks preserve prior checks; the old result is never mutated.
  previousChecks: PaymentCheck[];
  idempotencyKey: string | null;

  // Derived, verbatim from the backend.
  decision: PaymentVerdict | null;
  settlementVerdict: SettlementVerdict | null;
  anchorState: PurchaseReceipt["anchor"] | null;

  // Actions.
  runProbe: () => Promise<void>;
  loadAgentPayService: () => Promise<void>;
  runCheck: () => Promise<void>;
  recheck: () => Promise<void>;
  cancelCheck: () => Promise<void>;
  verifySettlement: (transactionHash: string) => Promise<void>;
  recordObservation: (input: ResponseObservationInput) => Promise<void>;
  refreshReceipt: () => Promise<void>;
  loadProviderDecisions: () => Promise<void>;
  saveProviderRule: (kind: "pin" | "deny", durationDays: number) => Promise<void>;
  loadPolicy: () => Promise<void>;
  saveAssetPolicy: (dailyCap: string) => Promise<void>;
  preparePaymentDetails: () => Promise<void>;
  payWithWallet: () => Promise<void>;
  reset: () => void;
  signOut: () => void;
};

const ANCHOR_TERMINAL: ReadonlySet<PurchaseReceipt["anchor"]["status"]> = new Set([
  "off_chain_verified",
  "anchored",
  "failed"
]);
const POLL_BASE_MS = 1_500;
const POLL_MAX_MS = 8_000;
const POLL_MAX_ATTEMPTS = 40;
const SETTLEMENT_POLL_ATTEMPTS = 30;
const SETTLEMENT_POLL_MS = 2_000;

const idleStep = <T,>(): AuditStepState<T> => ({ status: "idle", data: null, error: null });
const idleReceipt = (): ReceiptStepState => ({
  status: "idle",
  data: null,
  error: null,
  anchorPoll: "idle",
  attempts: 0
});

export function createIdempotencyKey(webCrypto: Crypto | null | undefined = globalThis.crypto): string {
  if (typeof webCrypto?.randomUUID === "function") return webCrypto.randomUUID();
  if (typeof webCrypto?.getRandomValues !== "function") {
    throw new Error("Secure browser randomness is unavailable. Update the browser and try again.");
  }

  const bytes = webCrypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function missingTokenError(): AuditApiError {
  return new AuditApiError({
    code: "credentials_required",
    message: "Connect Casper Wallet or use an AgentPay token before continuing.",
    status: 401
  });
}

function toApiError(cause: unknown): AuditApiError {
  if (cause instanceof AuditApiError) return cause;
  return new AuditApiError({
    code: "unexpected_error",
    message: cause instanceof Error ? cause.message : "The request failed unexpectedly.",
    status: 0
  });
}

export type UseAuditFlowOptions = {
  api?: AuditApiClient;
};

export function useAuditFlow(options: UseAuditFlowOptions = {}): AuditFlow {
  const apiRef = useRef<AuditApiClient>(options.api ?? new AuditApiClient());
  // Memory-only token. A ref keeps async callbacks reading the latest value; a
  // boolean in state drives re-render without ever exposing the token itself.
  const tokenRef = useRef<string | null>(null);
  const [tokenPresent, setTokenPresent] = useState(false);
  const [walletSession, setWalletSession] = useState<
    AuditStepState<{ publicKey: string; expiresAt: string }>
  >(idleStep);

  const [probeInput, setProbeInputState] = useState<ProbeInput>({ url: "", method: "GET" });
  const [authorizationText, setAuthorizationText] = useState("");
  const [authorization, setAuthorization] = useState<AuditStepState<AuthorizationIntent>>(idleStep);

  const [probe, setProbe] = useState<AuditStepState<ProbeResult>>(idleStep);
  const [check, setCheck] = useState<AuditStepState<CheckPaymentResult>>(idleStep);
  const [settlement, setSettlement] = useState<AuditStepState<VerifySettlementResult>>(idleStep);
  const [observation, setObservation] = useState<AuditStepState<ObservationResult>>(idleStep);
  const [receipt, setReceipt] = useState<ReceiptStepState>(idleReceipt);
  const [providerDecisions, setProviderDecisions] = useState<AuditStepState<ProviderDecision[]>>(idleStep);
  const [providerAction, setProviderAction] = useState<AuditStepState<ProviderDecision>>(idleStep);
  const [policy, setPolicy] = useState<AuditStepState<OperatorPolicy>>(idleStep);
  const [policyAction, setPolicyAction] = useState<AuditStepState<OperatorPolicy>>(idleStep);
  const [liveService, setLiveService] = useState<AuditStepState<AgentPayServiceQuote>>(idleStep);
  const [walletPayment, setWalletPayment] = useState<AuditStepState<CheckedWalletPaymentResult>>(idleStep);
  const [previousChecks, setPreviousChecks] = useState<PaymentCheck[]>([]);
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);

  const idempotencyKeyRef = useRef<string | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollRunRef = useRef(0); // Cancels stale poll loops on reset/recheck.

  const clearPollTimer = useCallback(() => {
    if (pollTimerRef.current !== null) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    pollRunRef.current += 1;
  }, []);

  useEffect(() => () => clearPollTimer(), [clearPollTimer]);

  const storeToken = useCallback((token: string) => {
    tokenRef.current = token.trim() ? token.trim() : null;
    setTokenPresent(Boolean(tokenRef.current));
  }, []);

  const setToken = useCallback((token: string) => {
    storeToken(token);
    setWalletSession(idleStep());
    setProviderAction(idleStep());
    setPolicy(idleStep());
    setPolicyAction(idleStep());
  }, [storeToken]);

  const connectWallet = useCallback(async () => {
    setWalletSession({ status: "running", data: null, error: null });
    try {
      const session = await createWalletSession(apiRef.current);
      storeToken(session.token);
      setWalletSession({
        status: "success",
        data: { publicKey: session.operatorPublicKey, expiresAt: session.expiresAt },
        error: null
      });
      setPolicy({ status: "running", data: null, error: null });
      try {
        const currentPolicy = await apiRef.current.getCurrentPolicy(session.token);
        setPolicy(
          currentPolicy
            ? { status: "success", data: currentPolicy, error: null }
            : { status: "idle", data: null, error: null }
        );
      } catch (cause) {
        setPolicy({ status: "error", data: null, error: toApiError(cause) });
      }
    } catch (cause) {
      setWalletSession({ status: "error", data: null, error: toApiError(cause) });
    }
  }, [storeToken]);

  const setProbeInput = useCallback((patch: Partial<ProbeInput>) => {
    setProbeInputState((current) => ({ ...current, ...patch }));
  }, []);

  const updateAuthorizationText = useCallback((value: string) => {
    setAuthorizationText(value);
    setAuthorization(idleStep());
    setWalletPayment(idleStep());
  }, []);

  const loadAgentPayService = useCallback(async () => {
    setLiveService({ status: "running", data: null, error: null });
    try {
      const quote = await apiRef.current.getAgentPayServiceQuote();
      const url = new URL(quote.paymentResource.url);
      if (url.protocol !== "https:" && url.protocol !== "http:") {
        throw new AuditApiError({
          code: "invalid_service_url",
          message: "AgentPay returned a payment URL that the checker cannot open.",
          status: 502,
          field: "paymentResource.url"
        });
      }
      setProbeInputState({ url: url.toString(), method: "POST", body: {} });
      setLiveService({ status: "success", data: quote, error: null });
    } catch (cause) {
      setLiveService({ status: "error", data: null, error: toApiError(cause) });
    }
  }, []);

  const runProbe = useCallback(async () => {
    const token = tokenRef.current;
    if (!token) {
      setProbe({ status: "error", data: null, error: missingTokenError() });
      return;
    }
    clearPollTimer();
    idempotencyKeyRef.current = null;
    setIdempotencyKey(null);
    setCheck(idleStep());
    setSettlement(idleStep());
    setWalletPayment(idleStep());
    setObservation(idleStep());
    setReceipt(idleReceipt());
    setPreviousChecks([]);
    setAuthorizationText("");
    setAuthorization(idleStep());
    setProviderAction(idleStep());
    setPolicyAction(idleStep());
    setProbe({ status: "running", data: null, error: null });
    try {
      const result = await apiRef.current.probe(token, {
        url: probeInput.url.trim(),
        method: probeInput.method ?? "GET",
        ...(probeInput.headers ? { headers: probeInput.headers } : {}),
        ...(probeInput.body !== undefined ? { body: probeInput.body } : {})
      });
      setProbe({ status: "success", data: result, error: null });
    } catch (cause) {
      setProbe({ status: "error", data: null, error: toApiError(cause) });
    }
  }, [clearPollTimer, probeInput]);

  const preparePaymentDetails = useCallback(async () => {
    const operatorPublicKey = walletSession.data?.publicKey;
    const terms = probe.data?.terms;
    if (!operatorPublicKey) {
      setAuthorization({
        status: "error",
        data: null,
        error: new AuditApiError({
          code: "wallet_session_required",
          message: "Connect Casper Wallet to prepare payment details for this account.",
          status: 401
        })
      });
      return;
    }
    if (!terms) {
      setAuthorization({
        status: "error",
        data: null,
        error: new AuditApiError({
          code: "charge_required",
          message: "Read a Casper x402 charge before preparing its payment details.",
          status: 409
        })
      });
      return;
    }

    setAuthorization({ status: "running", data: null, error: null });
    try {
      const draft = createPaymentDraft({
        terms,
        payerPublicKey: operatorPublicKey,
        nowEpochSeconds: Math.floor(Date.now() / 1_000)
      });
      setAuthorizationText(JSON.stringify(draft, null, 2));
      setAuthorization({ status: "success", data: draft, error: null });
    } catch (cause) {
      setAuthorization({ status: "error", data: null, error: toApiError(cause) });
    }
  }, [probe.data, walletSession.data]);

  const parseAuthorization = useCallback((): AuthorizationIntent | null => {
    const trimmed = authorizationText.trim();
    if (!trimmed) return null;
    // This is an unsigned authorization intent, not key material. Casper Wallet
    // signs its digest only after AgentPay returns PAY. The backend validates the
    // intent strictly and returns structured reasons.
    const parsed: unknown = JSON.parse(trimmed);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new AuditApiError({
        code: "invalid_authorization",
        message: "The pasted authorization intent must be a JSON object.",
        status: 400,
        field: "authorization"
      });
    }
    return parsed as AuthorizationIntent;
  }, [authorizationText]);

  const executeCheck = useCallback(
    async (key: string) => {
      const token = tokenRef.current;
      if (!token) {
        setCheck({ status: "error", data: null, error: missingTokenError() });
        return;
      }
      const probed = probe.data;
      if (!probed || !probed.terms) {
        setCheck({
          status: "error",
          data: null,
          error: new AuditApiError({
            code: "charge_required",
            message: "Read a supported Casper x402 charge before running the check.",
            status: 409,
            field: "paymentRequired"
          })
        });
        return;
      }
      let authorization: AuthorizationIntent | null;
      try {
        authorization = parseAuthorization();
      } catch (cause) {
        setCheck({ status: "error", data: null, error: toApiError(cause) });
        return;
      }
      setCheck({ status: "running", data: null, error: null });
      try {
        const result = await apiRef.current.createCheck(
          token,
          {
            request: probed.request,
            paymentRequired: probed.paymentRequired ?? paymentRequiredFromTerms(probed.terms),
            authorization
          },
          key
        );
        setCheck({ status: "success", data: result, error: null });
      } catch (cause) {
        setCheck({ status: "error", data: null, error: toApiError(cause) });
      }
    },
    [parseAuthorization, probe.data]
  );

  const runCheck = useCallback(async () => {
    // Reuse the current key so a transient retry is idempotent; mint one on the
    // first attempt of a fresh check.
    let key = idempotencyKeyRef.current;
    if (!key) {
      try {
        key = createIdempotencyKey();
      } catch (cause) {
        setCheck({ status: "error", data: null, error: toApiError(cause) });
        return;
      }
      idempotencyKeyRef.current = key;
      setIdempotencyKey(key);
    }
    await executeCheck(key);
  }, [executeCheck]);

  const recheck = useCallback(async () => {
    // REVIEW resolution: the operator installed a PIN/DENY out of band; run a
    // brand-new check under a fresh idempotency key. The prior check is kept for
    // the record and never mutated.
    let key: string;
    try {
      key = createIdempotencyKey();
    } catch (cause) {
      setCheck({ status: "error", data: null, error: toApiError(cause) });
      return;
    }
    clearPollTimer();
    setPreviousChecks((current) => (check.data ? [...current, check.data.check] : current));
    setSettlement(idleStep());
    setWalletPayment(idleStep());
    setObservation(idleStep());
    setReceipt(idleReceipt());
    idempotencyKeyRef.current = key;
    setIdempotencyKey(key);
    await executeCheck(key);
  }, [check.data, clearPollTimer, executeCheck]);

  const cancelCheck = useCallback(async () => {
    const token = tokenRef.current;
    const checkId = check.data?.check.id;
    if (!token || !checkId) return;
    try {
      const result = await apiRef.current.cancelCheck(token, checkId);
      setCheck((current) =>
        current.data
          ? { ...current, data: { ...current.data, check: result.check as PaymentCheck } }
          : current
      );
    } catch (cause) {
      setCheck((current) => ({ ...current, error: toApiError(cause) }));
    }
  }, [check.data]);

  const verifySettlement = useCallback(
    async (transactionHash: string) => {
      const token = tokenRef.current;
      const checkId = check.data?.check.id;
      if (!token || !checkId) {
        setSettlement({ status: "error", data: null, error: missingTokenError() });
        return;
      }
      setSettlement({ status: "running", data: null, error: null });
      try {
        const result = await apiRef.current.verifySettlement(token, checkId, transactionHash.trim());
        // "success" is only that the request completed. The verdict
        // (match/pending/mismatch/unverifiable) stays in result.proof.verdict and
        // is never collapsed here.
        setSettlement({ status: "success", data: result, error: null });
      } catch (cause) {
        setSettlement({ status: "error", data: null, error: toApiError(cause) });
      }
    },
    [check.data]
  );

  const pollReceipt = useCallback(
    (receiptId: string, attempt: number, runId: number) => {
      const token = tokenRef.current;
      if (!token) return;
      const delay = Math.min(POLL_BASE_MS * 2 ** Math.max(0, attempt - 1), POLL_MAX_MS);
      pollTimerRef.current = setTimeout(() => {
        if (runId !== pollRunRef.current) return; // Superseded by reset/recheck.
        void (async () => {
          try {
            const record = await apiRef.current.getReceiptRecord(token, receiptId);
            if (runId !== pollRunRef.current) return;
            const terminal = ANCHOR_TERMINAL.has(record.anchorState.status);
            setReceipt((current) => ({
              ...current,
              status: "success",
              data: record,
              error: null,
              anchorPoll: terminal ? "terminal" : "polling",
              attempts: attempt
            }));
            if (!terminal && attempt < POLL_MAX_ATTEMPTS) pollReceipt(receiptId, attempt + 1, runId);
          } catch (cause) {
            if (runId !== pollRunRef.current) return;
            setReceipt((current) => ({ ...current, anchorPoll: "error", error: toApiError(cause) }));
          }
        })();
      }, delay);
    },
    []
  );

  const startReceiptPolling = useCallback(
    (record: PaymentReceiptRecord) => {
      clearPollTimer();
      const runId = pollRunRef.current;
      const terminal = ANCHOR_TERMINAL.has(record.anchorState.status);
      setReceipt({
        status: "success",
        data: record,
        error: null,
        anchorPoll: terminal ? "terminal" : "polling",
        attempts: 0
      });
      if (!terminal) pollReceipt(record.receipt.receiptId, 1, runId);
    },
    [clearPollTimer, pollReceipt]
  );

  const recordObservation = useCallback(
    async (input: ResponseObservationInput) => {
      const token = tokenRef.current;
      const checkId = check.data?.check.id;
      if (!token || !checkId) {
        setObservation({ status: "error", data: null, error: missingTokenError() });
        return;
      }
      setObservation({ status: "running", data: null, error: null });
      try {
        const result = await apiRef.current.recordObservation(token, checkId, input);
        setObservation({ status: "success", data: result, error: null });
        // The receipt body is immutable; its anchor state is dynamic and polled
        // separately from the hash-bearing body.
        startReceiptPolling({ receipt: result.receipt, anchorState: result.anchorState });
      } catch (cause) {
        setObservation({ status: "error", data: null, error: toApiError(cause) });
      }
    },
    [check.data, startReceiptPolling]
  );

  const payWithWallet = useCallback(async () => {
    const token = tokenRef.current;
    const checked = check.data?.check;
    const paymentRequired = probe.data?.paymentRequired;
    if (!token) {
      setWalletPayment({ status: "error", data: null, error: missingTokenError() });
      return;
    }
    if (!checked || paymentRequired === null || paymentRequired === undefined) {
      setWalletPayment({
        status: "error",
        data: null,
        error: new AuditApiError({
          code: "payment_challenge_missing",
          message: "Run the service check again before paying with Casper Wallet.",
          status: 409
        })
      });
      return;
    }

    clearPollTimer();
    const runId = pollRunRef.current;
    setWalletPayment({ status: "running", data: null, error: null });
    setSettlement(idleStep());
    setObservation(idleStep());
    setReceipt(idleReceipt());

    let submitted: CheckedWalletPaymentResult;
    try {
      submitted = await submitCheckedWalletPayment({
        check: checked,
        paymentRequired,
        probeInput,
        signAuthorization: (intent) => signWalletAuthorization(intent)
      });
      if (runId !== pollRunRef.current) return;
      setWalletPayment({ status: "success", data: submitted, error: null });
    } catch (cause) {
      if (runId !== pollRunRef.current) return;
      setWalletPayment({ status: "error", data: null, error: toApiError(cause) });
      return;
    }

    setSettlement({ status: "running", data: null, error: null });
    let verified: VerifySettlementResult | null = null;
    try {
      for (let attempt = 0; attempt < SETTLEMENT_POLL_ATTEMPTS; attempt += 1) {
        verified = await apiRef.current.verifySettlement(token, checked.id, submitted.transactionHash);
        if (runId !== pollRunRef.current) return;
        if (verified.proof.verdict === "match" || verified.proof.verdict === "mismatch") break;
        if (attempt + 1 < SETTLEMENT_POLL_ATTEMPTS) await delay(SETTLEMENT_POLL_MS);
      }
      if (!verified) throw new Error("Settlement verification did not return a result");
      setSettlement({ status: "success", data: verified, error: null });
    } catch (cause) {
      if (runId !== pollRunRef.current) return;
      setSettlement({ status: "error", data: null, error: toApiError(cause) });
      return;
    }

    if (verified.proof.verdict === "match") {
      await recordObservation(submitted.observation);
    }
  }, [check.data, clearPollTimer, probe.data, probeInput, recordObservation]);

  const refreshReceipt = useCallback(async () => {
    const token = tokenRef.current;
    const receiptId = receipt.data?.receipt.receiptId ?? observation.data?.receipt.receiptId;
    if (!token || !receiptId) return;
    try {
      const record = await apiRef.current.getReceiptRecord(token, receiptId);
      startReceiptPolling(record);
    } catch (cause) {
      setReceipt((current) => ({ ...current, anchorPoll: "error", error: toApiError(cause) }));
    }
  }, [observation.data, receipt.data, startReceiptPolling]);

  const loadProviderDecisions = useCallback(async () => {
    const token = tokenRef.current;
    if (!token) {
      setProviderDecisions({ status: "error", data: null, error: missingTokenError() });
      return;
    }
    setProviderDecisions({ status: "running", data: null, error: null });
    try {
      const result = await apiRef.current.listProviderDecisions(token);
      setProviderDecisions({ status: "success", data: result.decisions, error: null });
    } catch (cause) {
      setProviderDecisions({ status: "error", data: null, error: toApiError(cause) });
    }
  }, []);

  const saveProviderRule = useCallback(async (kind: "pin" | "deny", durationDays: number) => {
    const token = tokenRef.current;
    const operatorPublicKey = walletSession.data?.publicKey;
    const checked = check.data?.check;
    if (!token || !operatorPublicKey) {
      setProviderAction({
        status: "error",
        data: null,
        error: new AuditApiError({
          code: "wallet_session_required",
          message: "Connect Casper Wallet with the account that will sign this provider rule.",
          status: 401
        })
      });
      return;
    }
    if (!checked) {
      setProviderAction({
        status: "error",
        data: null,
        error: new AuditApiError({
          code: "check_required",
          message: "Run a payment check before approving or blocking a provider.",
          status: 409
        })
      });
      return;
    }
    if (![1, 7, 30, 90].includes(durationDays)) {
      setProviderAction({
        status: "error",
        data: null,
        error: new AuditApiError({
          code: "invalid_rule_duration",
          message: "Choose how long this provider rule should remain active.",
          status: 400,
          field: "durationDays"
        })
      });
      return;
    }

    setProviderAction({ status: "running", data: null, error: null });
    try {
      const decision = await saveProviderRuleWithWallet(apiRef.current, token, {
        decisionId: createIdempotencyKey(),
        kind,
        operatorPublicKey,
        origin: checked.request.origin,
        resourcePathPrefix: checked.request.path,
        payee: checked.terms.payTo,
        asset: checked.terms.asset,
        network: checked.terms.network,
        perCallCeiling: checked.terms.amount,
        expiresAt: new Date(Date.now() + durationDays * 24 * 60 * 60 * 1_000).toISOString(),
        promptedByCheckId: checked.id
      });
      setProviderAction({ status: "success", data: decision, error: null });
      const records = await apiRef.current.listProviderDecisions(token);
      setProviderDecisions({ status: "success", data: records.decisions, error: null });
    } catch (cause) {
      setProviderAction({ status: "error", data: null, error: toApiError(cause) });
    }
  }, [check.data, walletSession.data]);

  const loadPolicy = useCallback(async () => {
    const token = tokenRef.current;
    if (!token) {
      setPolicy({ status: "error", data: null, error: missingTokenError() });
      return;
    }
    setPolicy({ status: "running", data: null, error: null });
    try {
      const currentPolicy = await apiRef.current.getCurrentPolicy(token);
      setPolicy(
        currentPolicy
          ? { status: "success", data: currentPolicy, error: null }
          : { status: "idle", data: null, error: null }
      );
    } catch (cause) {
      setPolicy({ status: "error", data: null, error: toApiError(cause) });
    }
  }, []);

  const saveAssetPolicy = useCallback(async (dailyCap: string) => {
    const token = tokenRef.current;
    const operatorPublicKey = walletSession.data?.publicKey;
    const terms = check.data?.check.terms ?? probe.data?.terms;
    if (!token || !operatorPublicKey) {
      setPolicyAction({
        status: "error",
        data: null,
        error: new AuditApiError({
          code: "wallet_session_required",
          message: "Connect Casper Wallet with the account that will sign these payment rules.",
          status: 401
        })
      });
      return;
    }
    if (!terms) {
      setPolicyAction({
        status: "error",
        data: null,
        error: new AuditApiError({
          code: "charge_required",
          message: "Read a Casper x402 charge before setting its daily payment limit.",
          status: 409
        })
      });
      return;
    }
    if (!/^[1-9][0-9]*$/.test(dailyCap) || BigInt(dailyCap) < BigInt(terms.amount)) {
      setPolicyAction({
        status: "error",
        data: null,
        error: new AuditApiError({
          code: "invalid_daily_cap",
          message: "The daily limit must cover at least this charge and use a whole number of smallest token units.",
          status: 400,
          field: "dailyCap",
          expected: `at least ${terms.amount}`,
          received: dailyCap
        })
      });
      return;
    }

    setPolicyAction({ status: "running", data: null, error: null });
    try {
      const saved = await saveAssetPolicyWithWallet(apiRef.current, token, {
        policyId: createIdempotencyKey(),
        operatorPublicKey,
        asset: terms.asset,
        dailyCap,
        now: new Date().toISOString()
      });
      setPolicyAction({ status: "success", data: saved, error: null });
      setPolicy({ status: "success", data: saved, error: null });
    } catch (cause) {
      setPolicyAction({ status: "error", data: null, error: toApiError(cause) });
    }
  }, [check.data, probe.data, walletSession.data]);

  const reset = useCallback(() => {
    clearPollTimer();
    idempotencyKeyRef.current = null;
    setIdempotencyKey(null);
    setProbe(idleStep());
    setCheck(idleStep());
    setSettlement(idleStep());
    setWalletPayment(idleStep());
    setObservation(idleStep());
    setReceipt(idleReceipt());
    setProviderDecisions(idleStep());
    setProviderAction(idleStep());
    setPolicy(idleStep());
    setPolicyAction(idleStep());
    setAuthorization(idleStep());
    setLiveService(idleStep());
    setPreviousChecks([]);
    setAuthorizationText("");
  }, [clearPollTimer]);

  const signOut = useCallback(() => {
    tokenRef.current = null;
    setTokenPresent(false);
    setWalletSession(idleStep());
    reset();
  }, [reset]);

  const decision = check.data?.check.decision.verdict ?? null;
  const settlementVerdict = settlement.data?.proof.verdict ?? null;
  const anchorState = receipt.data?.anchorState ?? null;

  return useMemo(
    () => ({
      tokenPresent,
      setToken,
      walletSession,
      connectWallet,
      probeInput,
      setProbeInput,
      authorizationText,
      setAuthorizationText: updateAuthorizationText,
      authorization,
      probe,
      check,
      settlement,
      observation,
      receipt,
      providerDecisions,
      providerAction,
      policy,
      policyAction,
      liveService,
      walletPayment,
      previousChecks,
      idempotencyKey,
      decision,
      settlementVerdict,
      anchorState,
      runProbe,
      loadAgentPayService,
      runCheck,
      recheck,
      cancelCheck,
      verifySettlement,
      recordObservation,
      refreshReceipt,
      loadProviderDecisions,
      saveProviderRule,
      loadPolicy,
      saveAssetPolicy,
      preparePaymentDetails,
      payWithWallet,
      reset,
      signOut
    }),
    [
      tokenPresent,
      setToken,
      walletSession,
      connectWallet,
      probeInput,
      setProbeInput,
      authorizationText,
      updateAuthorizationText,
      authorization,
      probe,
      check,
      settlement,
      observation,
      receipt,
      providerDecisions,
      providerAction,
      policy,
      policyAction,
      liveService,
      walletPayment,
      previousChecks,
      idempotencyKey,
      decision,
      settlementVerdict,
      anchorState,
      runProbe,
      loadAgentPayService,
      runCheck,
      recheck,
      cancelCheck,
      verifySettlement,
      recordObservation,
      refreshReceipt,
      loadProviderDecisions,
      saveProviderRule,
      loadPolicy,
      saveAssetPolicy,
      preparePaymentDetails,
      payWithWallet,
      reset,
      signOut
    ]
  );
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
