import { createReportApp } from "./app.js";

const port = Number(process.env.REPORT_API_PORT ?? 4021);
const app = createReportApp();

app.listen(port, () => {
  console.log(`report-api listening on http://127.0.0.1:${port}`);
});
