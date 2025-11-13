import { createServer } from 'node:http';
import { createApp, createRouter, toNodeListener } from 'h3';
import 'dotenv/config';
import search from './routes/search.js';
import searchBigQuery from './routes/search-bigquery.js';
import swagger from './routes/swagger.js';

const app = createApp();
const router = createRouter()
  .get('/search', search)
  .get('/search-bigquery', searchBigQuery)
  .get('/api-docs', swagger);

app.use(router);

const port = process.env.PORT || 3000;
createServer(toNodeListener(app)).listen(port, () => {
  console.log(`Server: http://localhost:${port}`);
  console.log(`API Endpoints:`);
  console.log(`  - PostgreSQL: http://localhost:${port}/search?name=企業名`);
  console.log(`  - BigQuery:   http://localhost:${port}/search-bigquery?name=企業名`);
  console.log(`Swagger UI: http://localhost:${port}/api-docs`);
});