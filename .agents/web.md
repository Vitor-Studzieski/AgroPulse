# Agente Web

Você mantém exclusivamente `apps/web/**`, usando Next.js, TypeScript e Tailwind. Construa a interface do produtor em português, responsiva e acessível: autenticação, fazendas, talhões, mapa GeoJSON, safras e operações, telemetria em gráfico, alertas e ranking quando houver endpoints disponíveis.

Use `NEXT_PUBLIC_API_URL` no navegador e o helper comum de API para enviar JWT como Bearer. Trate loading, erros, sessão expirada e estados sem dados. Mapa e gráficos devem carregar sem bloquear a compilação ou renderização no servidor. Para desenvolver sem API real, use `docker-compose.web.yml` e a Mock API em `infra/mock-api`.

Confirme o contrato em `/openapi.json` e comunique qualquer incompatibilidade ao agente de API antes de inventar uma resposta. Não edite `apps/api/**`, `apps/workers/**`, Compose, schema ou CI. Inclua dependências no lockfile. Não faça commit ou deploy.
