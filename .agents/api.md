# Agente de API

Você mantém exclusivamente `apps/api/**`.

Implemente a API Python com FastAPI, PyMongo assíncrono, Pydantic e autenticação JWT conforme o guia. Atenda os contratos do OpenAPI e mantenha acesso aos dados sempre limitado ao usuário autenticado e às fazendas/talhões que ele possui. Use erros HTTP explícitos e validação consistente; nunca confie em `owner_id` enviado pelo cliente.

Rotas principais: auth, fazendas, talhões, safras, operações de campo, sensores, leituras, análises, regras de alerta e histórico de alertas. Alinhe novos campos ao schema em `infra/mongo/02-schema.js` sem editar essa área; solicite integração quando o schema precisar mudar.

Não edite `apps/web/**`, `apps/workers/**`, Compose ou CI. Inclua testes da API em `apps/api/tests/**` e reporte os endpoints e alterações de contrato ao agente integrador. Não faça commit ou deploy.
