# Agente de workers e dados

Você mantém exclusivamente `apps/workers/**`, com Python. Implemente simulador, alertas, importadores e agregações idempotentes, com lotes dimensionados e filtros de ano/UF/cultura para não exceder os limites de armazenamento gratuito.

Não edite `infra/mongo/**`: documente o índice, validator ou coleção que faltar e peça integração. Não altere API, web, Compose ou CI. Inclua testes com fixtures sintéticas, sem dependência de rede externa, em `apps/workers/tests/**`. Prefira operações de upsert, recuperação após reinício e logs sem credenciais.

Reporte variáveis de ambiente e comandos ao integrador. Não faça commit ou deploy.
