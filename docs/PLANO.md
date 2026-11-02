# Plano do grupo

Prazo de entrega: **16/11/2026**. A data da apresentação no laboratório deve ser confirmada com o professor.

## Responsabilidade pelo projeto

Vitor Studzieski é responsável pelo resultado integral do projeto e coordena todas as frentes técnicas e entregas acadêmicas: código, integração, validação, infraestrutura, CI, evidências, relatório e apresentação. O grupo pode combinar a divisão das falas, mas a responsabilidade final permanece com Vitor; não há donos técnicos separados por diretório.

## Cronograma

| Período | Meta |
|---|---|
| 29/10 a 04/11 | `make demo` funcionando em um comando para todos. CRUD completo de fazendas, talhões, safras e operações. Login no front |
| 05/11 a 11/11 | Mapa com talhões, gráficos de telemetria, importação INMET, rollup, alertas funcionando |
| 12/11 a 16/11 | Congelar funcionalidades. Prints, relatório, ensaio da apresentação, envio por e-mail |

## Status de implementação

O guia foi importado com as frentes distribuídas por diretório. O status funcional atual pode ser conferido pela OpenAPI em `/docs`, pelo painel Next.js e pela suíte de CI. Os itens que ainda dependem do grupo são os RAs, a data e o ensaio da apresentação.

A correspondência entre os requisitos RF01–RF10, código, verificações e pendências está em [docs/REQUISITOS.md](REQUISITOS.md).

O [modelo de relatório técnico](RELATORIO-MODELO.md) já traz a estrutura do capítulo 14, as Figuras 1–3 extraídas do guia e os 28 nomes previstos para as capturas. As imagens em [docs/figuras/guia](figuras/guia/) são referências de arquitetura, não evidência de execução. Os nomes informados — Vitor Studzieski, Maria Fernanda Passos e Lauan Alves Ferneda — já constam na capa; faltam os RAs. A data da apresentação pode ser acrescentada ao roteiro quando definida. O remoto público está registrado no relatório e a branch `feature/agropulse-completion` está publicada no PR #1, que permanece aberto. A pasta [docs/evidencias](evidencias/) contém os 28 arquivos numerados, revisados como finais. As capturas 15 e 18 foram refeitas no Compass sem erros exploratórios; `painel-visao-geral.png` é complementar. O [vídeo silencioso de demonstração](apresentacao/demonstracao-agropulse.mp4) é uma gravação contínua de 44 segundos da aba local no Chrome; trechos da visão geral, do mapa de talhões e dos sensores foram conferidos.

O [roteiro de apresentação](ROTEIRO-APRESENTACAO.md) organiza a demonstração local, reforça o recorte geográfico único do campus e lista os cuidados para não misturar dados sintéticos com fontes oficiais.

## Checklist do relatório

| Exigência da atividade | Como evidenciar |
|---|---|
| Prints do máximo de telas | Login, lista de fazendas, mapa dos talhões, gráficos de telemetria, alertas, Swagger (`/docs`) |
| Prints do código e comandos de persistência | `app/routers/fields.py` (insert, update, delete), `workers/simulator.py` (`insert_many`), `infra/mongo/02-schema.js`, `workers/rollup.py` (`$merge`) |
| Prints da base de dados | Compass ou mongosh: coleções, documentos, `getCollectionInfos` da time series, `explain`, falha de validação (veja `docs/MODELO-DADOS.md`) |
| Link do GitHub | Repositório público ou com acesso para o professor |
| Identificação dos integrantes | Nome e RA de cada integrante na capa do relatório |
| Vídeo de contingência | [MP4 silencioso de 44 segundos](apresentacao/demonstracao-agropulse.mp4), gravação contínua da aba local no Chrome; mostra trechos da visão geral, mapa de talhões e sensores |

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
