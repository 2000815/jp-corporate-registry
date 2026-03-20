import { createServer } from "node:http";
import { createApp, createRouter, toNodeListener } from "h3";
import "dotenv/config";
import companies from "./routes/companies.js";
import syncDiff from "./routes/sync-diff.js";
import swagger from "./routes/swagger.js";

const app = createApp();
const router = createRouter()
  .get("/api/companies", companies)
  .post("/api/sync/diff", syncDiff)
  .get("/api-docs", swagger);

app.use(router);

const port = process.env.PORT || 3000;
createServer(toNodeListener(app)).listen(port, () => {
  console.log(`Server: http://localhost:${port}`);
  console.log(`API Endpoints:`);
  console.log(
    `  - Companies:  http://localhost:${port}/api/companies?query=東京 サンプル`,
  );
  console.log(
    `  - Sync Diff:  POST http://localhost:${port}/api/sync/diff (X-API-Key required)`,
  );
  console.log(`Swagger UI: http://localhost:${port}/api-docs`);
});
