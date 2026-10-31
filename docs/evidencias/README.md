# Evidências acadêmicas

Salve as capturas listadas no apêndice A de [RELATORIO-MODELO.md](../RELATORIO-MODELO.md) nesta pasta, mantendo os nomes numerados. Inclua resultados reais da execução e deixe visível o contexto necessário para interpretar cada imagem.

Use apenas dados de demonstração nos prints. Não inclua senhas, tokens, strings de conexão, dados pessoais ou credenciais de serviços. Para GitHub Actions, capture o resultado real depois que o workflow remoto for executado; não produza uma imagem ilustrativa no lugar do check.

Das 28 capturas previstas no apêndice A, os 28 arquivos numerados estão salvos e revisados. As capturas 01–09 foram refeitas como captura direta do viewport do Chrome, sem moldura do navegador. As telas 01–08 vêm da interface da demonstração isolada, mapeada nesta sessão em `http://localhost:34100/`; para reproduzir em portas isoladas, use `WEB_PORT=34100 API_PORT=34101 MONGO_PORT=34102 make demo` (o padrão do Compose usa 3000/8000/27017). A captura 09 usa `http://localhost:8000/docs#/infra/health_health_get` e registra a resposta HTTP 200 (`{"status":"ok"}`) de `GET /health`. A contagem na captura 15 é 21.006 leituras no instante da consulta; como o simulador continua ativo, o valor muda durante a execução. A captura 18 confirma `IXSCAN` pelo índice `crop_1`, e a captura 26 mostra a coleção `field_daily_stats` com 24 documentos agregados. `painel-visao-geral.png` é a captura complementar do painel: mostra o histórico anual 2024 da estação INMET A763/Marília a 27,8 km do campus e o ranking municipal do IBGE. As telas de Safras e Operações mostram estados vazios reais da demonstração; não foram criados registros apenas para preencher capturas. A captura 28 registra o run #23 do commit `34d09fd`; os cinco jobs do GitHub Actions passaram. Os RAs e a data da apresentação devem ser completados pelo grupo antes da entrega.

## Conteúdo de cada captura

Use esta lista para conferir o enquadramento antes de marcar um item como concluído:

| Arquivo(s) | Mostrar |
|---|---|
| `01-login`–`09-swagger` | Capturas diretas do viewport do Chrome, sem moldura do navegador: login sem credencial digitada; fazenda/talhões do seed; mapa centrado somente no campus Fatec Pompéia; gráfico de umidade; telas de safras, operações e alertas; `/docs` com `GET /health` e resposta demonstrativa. A captura usa `http://localhost:34100/`; o Compose padrão serve a interface em `http://localhost:3000/`. Swagger: `http://localhost:8000/docs#/infra/health_health_get`. |
| `10-codigo-insert-talhao`, `11-codigo-insert-many`, `12-schema-js`, `13-codigo-merge`, `14-codigo-change-stream` | VS Code com números de linha: `apps/api/app/routers/fields.py`, `apps/workers/workers/simulator.py`, `infra/mongo/02-schema.js`, `apps/workers/workers/rollup.py` e `apps/workers/workers/alerts.py`, respectivamente. |
| `15-count-leituras` | Compass mongosh: `db.sensor_readings.countDocuments()` e resultado não nulo, sem mensagens de erro anteriores no enquadramento. |
| `16-getcollectioninfos-timeseries` | Compass mongosh: `db.getCollectionInfos({ name: "sensor_readings" })` mostrando `timeseries` e `expireAfterSeconds`. |
| `17-validacao-erro` | Compass mongosh executando `db.farms.insertOne({ name: "x", state: "mato grosso" })`; enquadrar o erro de validação. O documento inválido não deve ser persistido. |
| `18-explain-ixscan` | Compass mongosh: `db.fields.find({ crop: "soja" }).hint({ crop: 1 }).explain("executionStats").queryPlanner.winningPlan` com o estágio `IXSCAN` visível e sem mensagens de erro exploratórias no enquadramento. Use uma aba de shell nova para não deixar erros de tentativas anteriores no print. O `hint` torna o plano reproduzível com apenas três talhões de demonstração. |
| `19-geointersects` | Compass mongosh: consultar `fields.boundary` com `$geoIntersects` no ponto do campus `[-50.1994, -22.1110]`; mostrar o talhão de demonstração retornado. |
| `20-agregacao-media-diaria` | Compass mongosh: média diária de `soil_moisture` agrupada por talhão e dia, conforme consulta em `docs/MODELO-DADOS.md`. |
| `21-compass-colecoes`, `22-documento-fields`, `23-documento-sensor-reading`, `24-indices-fields`, `25-validacao-farms`, `26-field-daily-stats` | Compass: lista de coleções; documento de `fields`; documento em `sensor_readings`; índices de `fields`; validação de `farms`; documento agregado em `field_daily_stats`. `make demo` executa o rollup inicial. |
| `27-github-repo`, `28-github-actions-verde` | Branch público `feature/agropulse-completion` e PR #1 aberto. A captura 28 registra os cinco jobs aprovados no run #23 do commit `34d09fd` (API, workers, web, schema e Compose). O PR permanece aberto para revisão, sem merge. |

Para os itens 15–20, mantenha comando e resposta na mesma captura. Não mostre tokens, senhas, connection strings, dados pessoais ou documentos fora da demonstração. Os itens 15–28 foram conferidos visualmente.
