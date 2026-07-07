import { createReportApp } from "./app.js";

const port = Number(process.env.REPORT_API_PORT ?? 4021);
const host = process.env.REPORT_API_HOST ?? "127.0.0.1";
const app = createReportApp();

app.listen(port, host, () => {
  console.log(`report-api listening on http://${host}:${port}`);
});
