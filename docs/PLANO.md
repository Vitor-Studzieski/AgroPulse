# Plano do grupo

Prazo de entrega: **16/11/2026**. A data da apresentação no laboratório deve ser confirmada com o professor.

## Divisão sugerida para 4 integrantes

| Integrante | Foco | Entregas |
|---|---|---|
| 1 | Infra e banco | Compose, schema, índices, seed, importador INMET, rollup |
| 2 | API | Rotas de `seasons`, `operations`, `sensors` e `alert_rules` seguindo o padrão de `farms`/`fields`; testes |
| 3 | Front | Login, lista de fazendas e talhões, mapa Leaflet com polígonos, gráficos de série |
| 4 | Dados e relatório | Importação IBGE/CONAB, consultas de agregação, prints, relatório, roteiro da apresentação |

## Cronograma

| Período | Meta |
|---|---|
| 29/10 a 04/11 | `make up` funcionando para todos. CRUD completo de fazendas, talhões, safras e operações. Login no front |
| 05/11 a 11/11 | Mapa com talhões, gráficos de telemetria, importação INMET, rollup, alertas funcionando |
| 12/11 a 16/11 | Congelar funcionalidades. Prints, relatório, ensaio da apresentação, envio por e-mail |

## O que já está pronto no repositório

CRUD de fazendas e talhões, autenticação, leitura de telemetria, quatro agregações, simulador, alertas com change stream, importador INMET, rollup com `$merge`, schema com validação e índices, CI.

## O que falta implementar

- Rotas de `seasons`, `operations`, `sensors` e `alert_rules` (as coleções e validações já existem).
- Importador de produção agrícola do IBGE para `ibge_production` (SIDRA, tabela de produção agrícola municipal).
- Telas do front além da página inicial.
- Testes de integração da API contra um MongoDB real.

## Checklist do relatório

| Exigência da atividade | Como evidenciar |
|---|---|
| Prints do máximo de telas | Login, lista de fazendas, mapa dos talhões, gráficos de telemetria, alertas, Swagger (`/docs`) |
| Prints do código e comandos de persistência | `app/routers/fields.py` (insert, update, delete), `workers/simulator.py` (`insert_many`), `infra/mongo/02-schema.js`, `workers/rollup.py` (`$merge`) |
| Prints da base de dados | Compass ou mongosh: coleções, documentos, `getCollectionInfos` da time series, `explain`, falha de validação (veja `docs/MODELO-DADOS.md`) |
| Link do GitHub | Repositório público ou com acesso para o professor |
| Identificação dos integrantes | Nome e RA de cada integrante na capa do relatório |

Tire os prints durante o desenvolvimento, não no último dia.

## Truque para a demo de alertas

Para disparar um alerta na hora, aumente o limiar das regras:

```js
db.alert_rules.updateMany({}, { $set: { threshold: 80 } })
```

O alerta aparece em até 30 segundos em `db.alerts.find()` e no log do serviço `alerts`.
