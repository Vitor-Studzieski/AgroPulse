# Prompts por frente

Use uma tarefa por branch e worktree próprios. As instruções complementam a regra de escopo no [`AGENTS.md`](../AGENTS.md); elas orientam os agentes, não substituem revisão, CI ou proteção de branch.

- [API](api.md)
- [Web](web.md)
- [Workers e dados](workers.md)
- [Integração e infraestrutura](integracao.md)

Os contratos HTTP são definidos pelos modelos Pydantic e publicados por FastAPI em `/openapi.json`. Mudanças em rotas devem atualizar o OpenAPI e manter as respostas consumidas pelo front compatíveis.
