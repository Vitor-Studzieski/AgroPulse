# AgroPulse

Acompanhamento operacional por talhão, com telemetria comparativa, contexto climático e produtivo e um fluxo rastreável entre alertas e manejo, construído sobre MongoDB.

Projeto da atividade prática **IAL-215 – Banco de Dados NoSQL**.

## Recorte do produto

O AgroPulse é um diário operacional auditável por talhão. O responsável registra quem executou cada atividade, quando, em qual área, com quais custos e equipamentos, e pode anexar comprovantes. O fluxo de triagem liga o alerta ao talhão, permite resolver ou reabrir o evento e iniciar um registro de manejo contextualizado.

O diferencial é combinar uma visão comparativa de umidade e disponibilidade dos sensores entre talhões com a trilha de manejo, contexto climático e dados municipais de produtividade. A análise de irrigação compara a média dos sensores nas 24 horas antes e depois de uma operação registrada. Essa comparação temporal não prova causalidade. O protótipo não recomenda horário nem lâmina de irrigação. Na demonstração, leituras e polígonos são sintéticos; a estação INMET A763/Marília, a 27,8 km do campus, fornece apenas contexto regional.

## Entrega acadêmica

- [Apresentação em PowerPoint](docs/apresentacao/AgroPulse-IAL-215.pptx)
- [Roteiro de 12 minutos](docs/ROTEIRO-APRESENTACAO.md)
- [Relatório técnico final (DOCX)](docs/RELATORIO-TECNICO.docx)
- [Fonte editável do relatório (Markdown)](docs/RELATORIO-MODELO.md)
- [Evidências nomeadas](docs/evidencias/README.md)
- [Vídeo local de demonstração (44 s, sem áudio)](docs/apresentacao/demonstracao-agropulse.mp4)

## Subir a demonstração local

Pré-requisito: Docker com Compose.

```bash
make demo
```

Esse comando constrói e inicia a stack integrada, aplica e verifica o schema MongoDB, executa o seed idempotente com três talhões sintéticos próximos ao campus da Fatec Pompéia, carrega o histórico anual oficial da estação INMET mais próxima e a amostra PAM/SIDRA 2023 de São Paulo, e ativa o simulador e o worker de alertas. Não é necessário criar `.env` nem baixar os dados climáticos e agrícolas da demonstração. A primeira construção exige que as imagens e dependências estejam disponíveis no Docker, e o mapa usa tiles do OpenStreetMap, que precisam de internet para exibir o fundo cartográfico. Para encerrar sem apagar os dados, rode `make down`; `make reset` remove os volumes locais.

Para apenas iniciar a stack sem executar novamente o seed, use `make up`. `make setup` é opcional e copia `.env.example` para `.env` para personalizar configurações locais.

Para trabalhar em uma frente sem depender das outras, use os ambientes isolados:

```bash
make web-dev      # Next.js + Mock API, portas 3001 e 8010
make api-dev      # FastAPI + MongoDB exclusivo, porta 8001
make api-seed     # dados de demonstração para a API isolada
make workers-dev  # workers + MongoDB exclusivo, porta 27019 (seed automático)
```

Cada ambiente tem projeto e volume Docker próprios. O Compose dos workers aplica o schema e cria fazenda, talhões e sensores sintéticos antes de iniciar a simulação. Pare somente a frente que usou, por exemplo `docker compose -p agropulse-web -f docker-compose.web.yml down`.

| Serviço | URL |
|---|---|
| Web | http://localhost:3000 |
| API (Swagger) | http://localhost:8000/docs |
| MongoDB (Compass) | `mongodb://localhost:27017/?directConnection=true` |
| n8n (opcional) | `docker compose --profile automation up -d n8n` → http://localhost:5678 |

Login de demonstração criado pelo seed: `demo@agropulse.dev` / `demo12345`.

A referência geográfica da demonstração é somente o campus da Fatec Pompéia (latitude `-22.1110`, longitude `-50.1994`). Os talhões do seed são polígonos sintéticos próximos desse ponto para mostrar o mapa; não representam limites oficiais nem áreas agrícolas reais da Fatec.

O simulador espera existirem sensores. `make demo` cria sensores, gera 7 dias de histórico, inicia as leituras ao vivo e executa o rollup diário inicial; o serviço continua atualizando os resumos a cada 24 horas. Use `make seed` para reaplicar os dados de demonstração sem apagar o volume.

O seed pode ser executado novamente: ele atualiza a localização e a geometria sintética da fazenda de demonstração, repara sensores ou regras ausentes e mantém as leituras e dados de operação já gravados. O perfil pode ser alterado no painel; alterações e exclusão da conta exigem a senha atual.

No painel, a seleção de um talhão mostra a série de telemetria, o histórico 2024 da estação INMET A763/Marília (a 27,8 km do campus) e o ranking municipal de produção do IBGE para São Paulo, ano-base 2023. A estação é a fonte climática oficial mais próxima, não uma segunda fazenda da demonstração. O painel prioriza os últimos sete dias quando há observações recentes; se a janela estiver vazia, seleciona automaticamente o ano importado mais recente. O período continua ajustável no seletor.

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
mkdir -p data/imports
# Copie os CSV/ZIP do INMET e outras exportações SIDRA para data/imports/.
make import-inmet INMET_ARGS="--year 2024 --file /imports/2024.zip --states SP"
make import-ibge IBGE_ARGS="--year 2024 --file /imports/pam.csv --states MT SP GO --crops soja milho cana"
make rollup
```

Os arquivos `data/imports/pam-sp-2023.csv` e `data/imports/inmet-sp-a763-2024.zip` são amostras oficiais compactas e versionadas para demonstração; o segundo contém somente a estação mais próxima do campus. `make demo` importa os registros completos disponíveis para soja, milho, cana e o histórico anual do INMET. Para atualizar a amostra SIDRA pela internet, use `python scripts/download_pam_sp.py`; outros arquivos locais de importação não devem ser versionados. Consulte [as fontes e recortes das amostras](data/imports/README.md). O Compose monta `data/imports` como `/imports` somente leitura dentro do container.

## Dependências Python

As versões diretas ficam fixadas em `apps/api/requirements.txt` e `apps/workers/requirements.txt`. Os arquivos `requirements*.lock` registram também as dependências transitivas e os hashes para Python 3.12. Docker e CI instalam esses locks sem precisar de serviço pago. Ao atualizar uma dependência, ajuste a versão direta e regenere os locks conforme os comandos em [docs/REQUISITOS.md](docs/REQUISITOS.md#verificações-locais-concluídas).

Para rodar Ruff e pytest localmente em macOS/Linux, instale `uv` e execute `make test`. O alvo cria ambientes Python 3.12 separados para API e workers, instala os locks de desenvolvimento exigindo hashes e roda as duas suítes. A primeira execução pode baixar o Python e os pacotes gratuitos do PyPI; não altera o Python global. `make test-setup` prepara os ambientes sem executar os testes. As pastas `.venv` ficam fora do Git. A demonstração Docker e o CI não dependem desses ambientes locais.

## Estrutura

```
apps/api        FastAPI + PyMongo (async)
apps/workers    simulador de sensores, alertas, rollup e importadores INMET/IBGE
apps/web        Next.js + Tailwind
infra/mongo     replica set, schema, validações e índices
infra/mock-api  Mock API estática para desenvolvimento do front
docs            arquitetura, modelo de dados, deploy e plano do grupo
```

## Operação sem custo

O caminho principal é a execução local com Docker Compose. Para uma demonstração pública opcional, o repositório inclui `render.yaml` e `Dockerfile.render` para API/workers numa instância gratuita da Render, Atlas Free como banco e `apps/web` na Vercel Hobby. Essa publicação é de melhor esforço: há hibernação, cotas, limites de armazenamento e condições de uso; não há garantia 24/7 ou SLA. Se cadastro ou uso exigir cartão, trial ou upgrade, mantenha o projeto local. Veja [docs/DEPLOY.md](docs/DEPLOY.md) antes de qualquer publicação.

`docker-compose.prod.yml` permanece como alternativa para execução em uma VM própria com Docker e domínio configurado; ela não é necessária para desenvolvimento ou avaliação local.

Para configurar agentes por frente, isolamento, contratos e integração por PR, consulte [AGENTS.md](AGENTS.md).

O fluxo de branches, os checks exigidos e a configuração da proteção de `main` estão em [docs/GITHUB.md](docs/GITHUB.md).

## Documentação

- [Arquitetura](docs/ARQUITETURA.md)
- [Posicionamento e recorte do produto](docs/POSICIONAMENTO.md)
- [Proposta de diferenciais](docs/PROPOSTA-DIFERENCIAIS.md)
- [Matriz de requisitos e evidências](docs/REQUISITOS.md)
- [Modelo de dados](docs/MODELO-DADOS.md)
- [Deploy](docs/DEPLOY.md)
- [Plano do grupo e checklist do relatório](docs/PLANO.md)
- [Roteiro de apresentação](docs/ROTEIRO-APRESENTACAO.md)
- [Modelo de relatório técnico e lista de 28 evidências](docs/RELATORIO-MODELO.md)
