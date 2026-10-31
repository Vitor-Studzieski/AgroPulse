# Regras para agentes de código

## Limites por frente

- API: `apps/api/**`.
- Interface: `apps/web/**`.
- Workers e ingestão de dados: `apps/workers/**`.
- Infraestrutura compartilhada, contratos entre serviços e documentação: responsável pela integração, salvo tarefa explícita diferente.

Antes de editar outra frente, combine o contrato com quem mantém aquela área. Não altere `.env`, não grave credenciais e não faça deploy a partir de uma tarefa de implementação.

## Git e integração

- Uma tarefa deve trabalhar em uma branch própria e em um worktree próprio quando iniciada de forma independente.
- Não faça commit ou push sem pedido explícito.
- Integre alterações por pull request; exija o CI verde antes de mesclar em `main`.
- Se várias frentes estiverem ativas no mesmo checkout, respeite os limites acima e não edite arquivos compartilhados sem coordenação.

## Ambientes isolados

- Interface: `docker compose -p agropulse-web -f docker-compose.web.yml up --build` usa Mock API e portas 3001/8010.
- API: `docker compose -p agropulse-api -f docker-compose.api.yml up --build` usa um MongoDB local próprio e porta 8001.
- Workers: `docker compose -p agropulse-workers -f docker-compose.workers.yml up --build` usa um MongoDB local próprio e porta 27019.
- Stack integrada: `docker compose up --build`.

Os nomes de projeto e volumes separam os dados. Use `docker compose -p <nome> -f <arquivo> down` para parar apenas a frente correspondente. `down -v` apaga os dados daquela frente e só deve ser usado quando isso for intencional.
