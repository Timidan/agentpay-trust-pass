import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Router } from "express";
import { AuditorAuth } from "./auth.js";
import { NodeRpcClient } from "./casperRpc.js";
import { createAuditorRouter } from "./routes.js";
import { X402Probe } from "./probe.js";
import { createReceiptAnchorPublisherFromEnv, type ReceiptAnchorPublisher } from "./registry.js";
import { PaymentAuditService } from "./service.js";
import { openSqliteRepository, type SqliteAuditorRepository } from "./sqliteRepository.js";

const DEFAULT_CASPER_RPC_URL = "https://node.testnet.casper.network/rpc";
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const DEFAULT_DATABASE_PATH = resolve(REPO_ROOT, "data", "agentpay.sqlite");

export type AuditorRuntimeOptions = {
  databasePath: string;
  rpcUrl: string;
  publicOrigin: string;
  sessionCookiePath?: string;
  allowLoopbackProbeTargets?: boolean;
  now?: () => Date;
};

export type AuditorRuntime = {
  router: Router;
  repository: SqliteAuditorRepository;
  auth: AuditorAuth;
  service: PaymentAuditService;
  rpc: NodeRpcClient;
  probe: X402Probe;
  anchorPublisher: ReceiptAnchorPublisher | null;
  close(): void;
};

export function createAuditorRuntime(options: AuditorRuntimeOptions): AuditorRuntime {
  const repository = openSqliteRepository(options.databasePath, { now: options.now });
  try {
    const rpc = new NodeRpcClient({ rpcUrl: options.rpcUrl, now: options.now });
    const auth = new AuditorAuth({
      repository,
      publicOrigin: normalizeOrigin(options.publicOrigin),
      cookiePath: options.sessionCookiePath,
      now: options.now
    });
    const anchorPublisher = createReceiptAnchorPublisherFromEnv({
      repository,
      rpc,
      rpcUrl: options.rpcUrl
    });
    const service = new PaymentAuditService({
      repository,
      evidenceLoader: rpc,
      settlementLoader: rpc,
      anchorPublisher: anchorPublisher ?? undefined,
      now: options.now
    });
    const allowLoopback = options.allowLoopbackProbeTargets ?? false;
    const probe = new X402Probe({
      allowHttp: allowLoopback,
      allowLoopback,
      now: options.now
    });
    const router = createAuditorRouter({ repository, auth, service, probe });
    return {
      router,
      repository,
      auth,
      service,
      rpc,
      probe,
      anchorPublisher,
      close: () => {
        anchorPublisher?.close();
        repository.close();
      }
    };
  } catch (error) {
    repository.close();
    throw error;
  }
}

export function auditorRuntimeOptionsFromEnv(
  env: NodeJS.ProcessEnv = process.env
): AuditorRuntimeOptions {
  const port = validPort(env.REPORT_API_PORT ?? "4021");
  const host = env.REPORT_API_HOST?.trim() || "127.0.0.1";
  const publicOrigin =
    env.AGENTPAY_PUBLIC_ORIGIN?.trim() ||
    env.REPORT_API_PUBLIC_URL?.trim() ||
    `http://${host}:${port}`;
  return {
    allowLoopbackProbeTargets: env.AGENTPAY_ALLOW_LOOPBACK_PROBES === "1",
    databasePath: env.AGENTPAY_DATABASE_PATH?.trim()
      ? resolve(REPO_ROOT, env.AGENTPAY_DATABASE_PATH.trim())
      : DEFAULT_DATABASE_PATH,
    rpcUrl: env.CASPER_RPC_URL?.trim() || DEFAULT_CASPER_RPC_URL,
    sessionCookiePath: env.AGENTPAY_SESSION_COOKIE_PATH?.trim() || "/v1",
    publicOrigin
  };
}

function normalizeOrigin(value: string): string {
  return value.replace(/\/+$/, "");
}

function validPort(value: string): number {
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new TypeError("REPORT_API_PORT must be an integer from 1 to 65535");
  }
  return port;
}
