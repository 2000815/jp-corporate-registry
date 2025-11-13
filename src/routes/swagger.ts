import { defineEventHandler, setHeader } from 'h3';
import { openApiSpec } from '../openapi/spec.js';

export default defineEventHandler((event) => {
  setHeader(event, 'Content-Type', 'text/html; charset=utf-8');
  
  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <title>国税庁法人情報検索API</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
  <style>body { margin: 0; }</style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-standalone-preset.js"></script>
  <script>
    SwaggerUIBundle({
      spec: ${JSON.stringify(openApiSpec)},
      dom_id: '#swagger-ui',
      presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
      layout: "StandaloneLayout"
    });
  </script>
</body>
</html>`;
});
