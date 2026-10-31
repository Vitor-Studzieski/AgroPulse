# Plano do grupo

Prazo de entrega: **16/11/2026**. A data da apresentação no laboratório deve ser confirmada com o professor.

## Divisão provisória sugerida para 3 integrantes

Os nomes foram associados aos focos na ordem informada pelo grupo. A divisão pode ser ajustada entre os integrantes antes do ensaio.

| Integrante | Foco | Entregas |
|---|---|---|
| Vitor Studzieski | Infra, banco e ingestão | Compose, schema, índices, seed, importadores INMET e SIDRA/PAM, rollup |
| Maria Fernanda Passos | API e regras de negócio | Autenticação, CRUD, validações, autorização, alertas e testes de integração |
| Lauan Alves Ferneda | Interface, integração e entrega acadêmica | Login, painel, mapa, gráficos, evidências, relatório e roteiro da apresentação |

## Cronograma

| Período | Meta |
|---|---|
| 29/10 a 04/11 | `make demo` funcionando em um comando para todos. CRUD completo de fazendas, talhões, safras e operações. Login no front |
| 05/11 a 11/11 | Mapa com talhões, gráficos de telemetria, importação INMET, rollup, alertas funcionando |
| 12/11 a 16/11 | Congelar funcionalidades. Prints, relatório, ensaio da apresentação, envio por e-mail |

## Status de implementação

O guia foi importado com as frentes distribuídas por diretório. O status funcional atual pode ser conferido pela OpenAPI em `/docs`, pelo painel Next.js e pela suíte de CI. Itens do roteiro acadêmico, como capturas de tela, relatório, identificação dos integrantes e apresentação, ainda dependem do grupo e não são gerados pelo código.

A correspondência entre os requisitos RF01–RF10, código, verificações e pendências está em [docs/REQUISITOS.md](REQUISITOS.md).

O [modelo de relatório técnico](RELATORIO-MODELO.md) já traz a estrutura do capítulo 14, as Figuras 1–3 extraídas do guia e os 28 nomes previstos para as capturas. As imagens em [docs/figuras/guia](figuras/guia/) são referências de arquitetura, não evidência de execução. Os nomes informados — Vitor Studzieski, Maria Fernanda Passos e Lauan Alves Ferneda — já constam na capa; faltam os RAs e a data da apresentação. O remoto público está registrado no relatório e a branch `feature/agropulse-completion` está publicada no PR #1, que permanece aberto. A pasta [docs/evidencias](evidencias/) contém os 28 arquivos numerados, revisados como finais. As capturas 15 e 18 foram refeitas no Compass sem erros exploratórios. `painel-visao-geral.png` é complementar.

O [roteiro de apresentação](ROTEIRO-APRESENTACAO.md) organiza a demonstração local, reforça o recorte geográfico único do campus e lista os cuidados para não misturar dados sintéticos com fontes oficiais.

## Checklist do relatório

| Exigência da atividade | Como evidenciar |
|---|---|
| Prints do máximo de telas | Login, lista de fazendas, mapa dos talhões, gráficos de telemetria, alertas, Swagger (`/docs`) |
| Prints do código e comandos de persistência | `app/routers/fields.py` (insert, update, delete), `workers/simulator.py` (`insert_many`), `infra/mongo/02-schema.js`, `workers/rollup.py` (`$merge`) |
| Prints da base de dados | Compass ou mongosh: coleções, documentos, `getCollectionInfos` da time series, `explain`, falha de validação (veja `docs/MODELO-DADOS.md`) |
| Link do GitHub | Repositório público ou com acesso para o professor |
| Identificação dos integrantes | Nome e RA de cada integrante na capa do relatório |

Tire os prints durante o desenvolvimento, não no último dia.

## Demonstração isolada de alertas

A avaliação local ocorre a cada 30 segundos por padrão. Para evitar alterar a demonstração principal, escolha um nome de projeto e portas que estejam livres e prepare uma cópia isolada:

```bash
COMPOSE_PROJECT_NAME=agropulse-alert-demo WEB_PORT=43100 API_PORT=43101 MONGO_PORT=43102 make demo
```

No Compass ou `mongosh`, aumente somente o limiar da regra de umidade. O worker cria um alerta na próxima avaliação se ainda não houver um alerta aberto para essa regra; caso já exista, apresente o evento existente, pois o worker evita duplicatas:

```js
db.alert_rules.updateOne({ metric: "soil_moisture" }, { $set: { threshold: 80 } })
db.alerts.find({ status: "open" })
```

Depois de salvar as evidências, encerre apenas o projeto descartável e remova o volume que foi criado para ele:

```bash
docker compose -p agropulse-alert-demo down -v
```

Confira cuidadosamente o nome do projeto antes de usar `down -v`; não aplique esse comando à stack principal `agropulse`.
