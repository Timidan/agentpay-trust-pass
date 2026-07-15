import { resolve } from "node:path";
import type { Router } from "express";
import { AuditorAuth } from "./auth.js";
import { CasperRpcClient } from "./casperRpc.js";
import { createAuditorRouter } from "./routes.js";
import { PaymentAuditService } from "./service.js";
import { openSqliteRepository, type SqliteAuditorRepository } from "./sqliteRepository.js";

const DEFAULT_CASPER_RPC_URL = "https://node.testnet.casper.network/rpc";

export type AuditorRuntimeOptions = {
  databasePath: string;
  rpcUrl: string;
  publicOrigin: string;
  now?: () => Date;
};

export type AuditorRuntime = {
  router: Router;
  repository: SqliteAuditorRepository;
  auth: AuditorAuth;
  service: PaymentAuditService;
  rpc: CasperRpcClient;
  close(): void;
};

export function createAuditorRuntime(options: AuditorRuntimeOptions): AuditorRuntime {
  const repository = openSqliteRepository(options.databasePath, { now: options.now });
  try {
    const rpc = new CasperRpcClient({ rpcUrl: options.rpcUrl, now: options.now });
    const auth = new AuditorAuth({
      repository,
      publicOrigin: normalizeOrigin(options.publicOrigin),
      now: options.now
    });
    const service = new PaymentAuditService({ repository, evidenceLoader: rpc, now: options.now });
    const router = createAuditorRouter({ repository, auth, service });
    return { router, repository, auth, service, rpc, close: () => repository.close() };
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
  return {
    databasePath: env.AGENTPAY_DATABASE_PATH?.trim() || resolve(process.cwd(), "data", "agentpay.sqlite"),
    rpcUrl: env.CASPER_RPC_URL?.trim() || DEFAULT_CASPER_RPC_URL,
    publicOrigin:
      env.AGENTPAY_PUBLIC_ORIGIN?.trim() ||
      env.REPORT_API_PUBLIC_URL?.trim() ||
      `http://${host}:${port}`
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
