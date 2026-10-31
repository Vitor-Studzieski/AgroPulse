# Evidências acadêmicas

Salve as capturas listadas no apêndice A de [RELATORIO-MODELO.md](../RELATORIO-MODELO.md) nesta pasta, mantendo os nomes numerados. Inclua resultados reais da execução e deixe visível o contexto necessário para interpretar cada imagem.

Use apenas dados de demonstração nos prints. Não inclua senhas, tokens, strings de conexão, dados pessoais ou credenciais de serviços. Para GitHub Actions, capture o resultado real depois que o workflow remoto for executado; não produza uma imagem ilustrativa no lugar do check.

Das 28 capturas previstas no apêndice A, os 28 arquivos numerados estão salvos. Vinte e seis foram revisados como finais: `01-login.png` a `14-codigo-change-stream.png`, `16-getcollectioninfos-timeseries.png`, `17-validacao-erro.png`, `19-geointersects.png`, `20-agregacao-media-diaria.png`, `21-compass-colecoes.png`, `22-documento-fields.png`, `23-documento-sensor-reading.png`, `24-indices-fields.png`, `25-validacao-farms.png`, `26-field-daily-stats.png`, `27-github-repo.png` e `28-github-actions-verde.png`. As imagens 15 e 18 mostram os resultados esperados, mas também incluem erros exploratórios anteriores e devem ser recapturadas. A captura 26 mostra a coleção `field_daily_stats` com 24 documentos agregados. A captura Swagger mostra a rota pública `GET /health` e a resposta HTTP 200 (`{"status":"ok"}`). `painel-visao-geral.png` é uma imagem complementar do dashboard. As telas de Safras e Operações mostram estados vazios reais da demonstração; não foram criados registros apenas para preencher capturas. A imagem 28 registra o run #11 do commit `e7b3f94`; os cinco jobs do GitHub Actions passaram. Os runs #13 (`d3c7379`) e #17 (`c30728c`) também passaram nos cinco jobs; o #17 corresponde à revisão mais recente da branch. Os RAs e a data da apresentação devem ser completados pelo grupo antes da entrega.

## Conteúdo de cada captura

Use esta lista para conferir o enquadramento antes de marcar um item como concluído:

| Arquivo(s) | Mostrar |
|---|---|
| `01-login`–`09-swagger` | Navegador em tela cheia e endereço visível: login sem credencial digitada; fazenda/talhões do seed; mapa centrado somente no campus Fatec Pompéia; gráfico de umidade; telas de safras, operações e alertas; `/docs` com rota e resposta demonstrativa. |
| `10-codigo-insert-talhao`, `11-codigo-insert-many`, `12-schema-js`, `13-codigo-merge`, `14-codigo-change-stream` | VS Code com números de linha: `apps/api/app/routers/fields.py`, `apps/workers/workers/simulator.py`, `infra/mongo/02-schema.js`, `apps/workers/workers/rollup.py` e `apps/workers/workers/alerts.py`, respectivamente. |
| `15-count-leituras` | Compass mongosh: `db.sensor_readings.countDocuments()` e resultado não nulo, sem mensagens de erro anteriores no enquadramento. |
| `16-getcollectioninfos-timeseries` | Compass mongosh: `db.getCollectionInfos({ name: "sensor_readings" })` mostrando `timeseries` e `expireAfterSeconds`. |
| `17-validacao-erro` | Compass mongosh executando `db.farms.insertOne({ name: "x", state: "mato grosso" })`; enquadrar o erro de validação. O documento inválido não deve ser persistido. |
| `18-explain-ixscan` | Compass mongosh: `db.fields.find({ crop: "soja" }).hint({ crop: 1 }).explain("executionStats").queryPlanner.winningPlan` com o estágio `IXSCAN` visível e sem mensagens de erro exploratórias no enquadramento. Use uma aba de shell nova para não deixar erros de tentativas anteriores no print. O `hint` torna o plano reproduzível com apenas três talhões de demonstração. |
| `19-geointersects` | Compass mongosh: consultar `fields.boundary` com `$geoIntersects` no ponto do campus `[-50.1994, -22.1110]`; mostrar o talhão de demonstração retornado. |
| `20-agregacao-media-diaria` | Compass mongosh: média diária de `soil_moisture` agrupada por talhão e dia, conforme consulta em `docs/MODELO-DADOS.md`. |
| `21-compass-colecoes`, `22-documento-fields`, `23-documento-sensor-reading`, `24-indices-fields`, `25-validacao-farms`, `26-field-daily-stats` | Compass: lista de coleções; documento de `fields`; documento em `sensor_readings`; índices de `fields`; validação de `farms`; documento agregado em `field_daily_stats`. `make demo` executa o rollup inicial. |
| `27-github-repo`, `28-github-actions-verde` | Branch público `feature/agropulse-completion` e PR #1 aberto. A captura 28 mostra os cinco jobs aprovados no run #11 (`e7b3f94`); os runs #13 (`d3c7379`) e #17 (`c30728c`) também passaram nos cinco jobs. O PR permanece aberto para revisão. |

Para os itens 15–20, mantenha comando e resposta na mesma captura. Não mostre tokens, senhas, connection strings, dados pessoais ou documentos fora da demonstração. Os itens 21–28 já foram conferidos visualmente. Os itens 15 e 18 precisam ser recapturados sem os erros exploratórios.
