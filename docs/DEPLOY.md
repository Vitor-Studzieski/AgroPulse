# Deploy

A atividade exige código no GitHub, prints e apresentação no laboratório. Rodar tudo localmente com `docker compose` já cobre isso. O deploy em nuvem é opcional e serve para mostrar o produto funcionando por link.

## Opção recomendada para a apresentação

Levar o notebook com `make up` já executado e o histórico gerado. Não depende de internet nem de limites de plano gratuito.

## Opção em nuvem

| Parte | Onde | Observações |
|---|---|---|
| Banco | MongoDB Atlas, cluster gratuito (M0) | Crie usuário, libere o IP e copie a connection string `mongodb+srv://...`. Confira no momento da criação se o tier gratuito aceita time series e change streams |
| Schema | `mongosh "<connection string>" --file infra/mongo/02-schema.js` | Pule o `01-replica-set.js`; o Atlas já é replica set |
| API | Render, Railway ou Fly.io, usando `apps/api/Dockerfile` | Variáveis: `MONGO_URI`, `MONGO_DB`, `JWT_SECRET`, `CORS_ORIGINS` (URL da Vercel) |
| Web | Vercel, raiz do projeto em `apps/web` | Variável: `NEXT_PUBLIC_API_URL` apontando para a API |
| Workers | Máquina própria ou o notebook durante a demo | O simulador e o worker de alertas são processos de longa duração, que não combinam com planos gratuitos que hibernam |

Confira os limites atuais de cada plano gratuito antes de depender deles.

## Checklist de produção

- `JWT_SECRET` longo e aleatório, fora do repositório.
- Usuário do Atlas com permissão só no banco `agropulse`.
- CORS restrito à URL do front.
- `.env` no `.gitignore` (já está).
