# AgroPulse

Plataforma de monitoramento de safra com telemetria de sensores e dados climáticos, construída sobre MongoDB.

Projeto da atividade prática **IAL-215 – Banco de Dados NoSQL**.

## Subir o ambiente

Pré-requisito: Docker com Compose.

```bash
make setup
make up
make seed
```

| Serviço | URL |
|---|---|
| Web | http://localhost:3000 |
| API (Swagger) | http://localhost:8000/docs |
| MongoDB (Compass) | `mongodb://localhost:27017/?directConnection=true` |
| n8n (opcional) | `docker compose --profile automation up -d n8n` → http://localhost:5678 |

Login de demonstração criado pelo seed: `demo@agropulse.dev` / `demo12345`.

O simulador espera existirem sensores. Depois do `make seed` ele gera 7 dias de histórico e passa a inserir leituras ao vivo.

## Escalar o volume de dados

```bash
docker compose run --rm api python -m app.seed --fields 100 --sensors-per-field 5
```

Para regerar o histórico com os novos sensores, limpe as leituras e reinicie o simulador:

```bash
docker compose exec mongo mongosh agropulse --eval 'db.sensor_readings.deleteMany({})'
docker compose restart simulator
```

## Dados reais

```bash
make import-inmet
make rollup
```

## Estrutura

```
apps/api        FastAPI + PyMongo (async)
apps/workers    simulador de sensores, alertas, rollup, importador INMET
apps/web        Next.js + Tailwind
infra/mongo     replica set, schema, validações e índices
docs            arquitetura, modelo de dados, deploy e plano do grupo
```

## Documentação

- [Arquitetura](docs/ARQUITETURA.md)
- [Modelo de dados](docs/MODELO-DADOS.md)
- [Deploy](docs/DEPLOY.md)
- [Plano do grupo e checklist do relatório](docs/PLANO.md)
