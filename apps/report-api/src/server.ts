import { createReportApp } from "./app.js";
import { auditorRuntimeOptionsFromEnv, createAuditorRuntime } from "./auditor/runtime.js";
import { openSqlitePublicArtifactStore } from "./publicArtifacts.js";

const port = Number(process.env.REPORT_API_PORT ?? 4021);
const host = process.env.REPORT_API_HOST ?? "127.0.0.1";
const runtimeOptions = auditorRuntimeOptionsFromEnv();
const runtime = createAuditorRuntime(runtimeOptions);
const publicArtifactStore = openSqlitePublicArtifactStore(runtimeOptions.databasePath);
const app = createReportApp({
  auditorRouter: runtime.router,
  publicArtifactStore
});

const server = app.listen(port, host, () => {
  console.log(`report-api listening on http://${host}:${port}`);
});

let shuttingDown = false;
function shutdown(): void {
  if (shuttingDown) return;
  shuttingDown = true;
  server.close(() => {
    publicArtifactStore.close();
    runtime.close();
  });
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
