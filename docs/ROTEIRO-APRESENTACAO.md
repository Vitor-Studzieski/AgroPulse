# Roteiro da apresentação do AgroPulse

Roteiro de apoio para a demonstração acadêmica da atividade IAL-215. Ajuste a duração e a divisão de falas ao tempo definido pelo professor.

O [deck da apresentação (PPTX)](apresentacao/AgroPulse-IAL-215.pptx) tem seis slides alinhados à divisão sugerida abaixo e pode ser aberto localmente no dia da demonstração.

## Mensagem central

O AgroPulse reúne cadastro rural, telemetria, alertas e contexto climático e produtivo em uma plataforma que pode ser executada localmente sem custo incremental. A referência espacial da demonstração é somente o campus da Fatec Pompéia. Existe uma fazenda demonstrativa com três polígonos sintéticos próximos ao campus; eles servem para demonstrar operações geoespaciais e não representam talhões reais da Fatec.

## Preparação antes da apresentação

1. Na raiz do repositório, execute `make demo` e aguarde os importadores e o rollup terminarem.
2. Confira os serviços com `docker compose ps`. A stack integrada usa a interface em `http://localhost:3000`, a API em `http://localhost:8000/docs` e o MongoDB em `localhost:27017`.
3. Abra a interface e entre com a conta de demonstração descrita no README. Não projete nem inclua a senha em capturas.
4. Confirme que o painel mostra uma fazenda, três talhões, leituras de sensores, ranking PAM/SIDRA e o ano climático importado mais recente. No conjunto versionado, o ano disponível é 2024.
5. Deixe aberto o README, o Swagger e [as consultas MongoDB para o relatório](MODELO-DADOS.md). Não execute `make reset` durante a preparação: esse comando apaga os volumes locais.

## Vídeo curto de contingência

O [vídeo de demonstração](apresentacao/demonstracao-agropulse.mp4) está pronto para uso offline. É uma montagem silenciosa de 26,8 segundos, 1080p, feita com capturas da interface local aberta no Chrome: visão geral, talhões, sensores, regras de alerta e painéis do INMET e da PAM/SIDRA. Os quadros não mostram credenciais. A gravação contínua local autorizada ainda está pendente; até ela ser produzida e conferida, use esta montagem como contingência visual. A apresentação principal continua sendo a demonstração interativa da stack local.

## Divisão de falas em 12 minutos

Divisão sugerida para o ensaio, alinhada às frentes de trabalho descritas em [PLANO.md](PLANO.md). O grupo pode ajustar os tempos e as falas entre si.

| Tempo | Responsável sugerido | Slides / conteúdo |
|---:|---|---|
| 2 min | Lauan Alves Ferneda | Problema do produtor, objetivo do sistema e recorte espacial único no campus Fatec Pompéia |
| 3 min | Vitor Studzieski | Arquitetura e decisões MongoDB: documentos, time series, GeoJSON, índices e agregações |
| 3 min | Lauan Alves Ferneda | Demonstração: login, fazenda, mapa, gráfico, clima, ranking e alerta |
| 3 min | Vitor Studzieski e Maria Fernanda Passos | Compass: `sensor_readings`, índice `2dsphere`, agregação, validação e `explain` |
| 1 min | Maria Fernanda Passos | Conclusão, limitações e trabalhos futuros |

### Fala de 2 minutos: problema e recorte

Explique que o produtor precisa relacionar propriedades, áreas, atividades, sensores, clima e alertas. O AgroPulse reúne esses fluxos em uma plataforma. A única localização agrícola usada na demonstração é o campus da Fatec; os três polígonos são sintéticos e demonstram consultas espaciais, sem representar talhões reais.

### Fala de 3 minutos: arquitetura e MongoDB

Apresente o fluxo Next.js → FastAPI → MongoDB e os workers de simulação, importação, alertas e rollup. Destaque documentos para cadastros, coleção time series para leituras, GeoJSON com índice `2dsphere`, validação do schema e agregação diária com `$merge`.

### Fala de 3 minutos: demonstração da interface

Entre com a conta de demonstração descrita no README. Mostre a fazenda, o mapa centrado no campus, os três talhões, o gráfico de umidade e o alerta aberto. Apresente o clima oficial de 2024 da A763/Marília como contexto da estação mais próxima, a cerca de 27,8 km; ela não é outra fazenda nem mede o clima dentro do campus. Mostre também o ranking PAM/SIDRA de São Paulo como comparação regional.

### Fala de 3 minutos: demonstração no Compass

Use as consultas de [MODELO-DADOS.md](MODELO-DADOS.md) para mostrar `sensor_readings` e o TTL, o índice `2dsphere`, `$geoIntersects` no ponto do campus, média diária, `field_daily_stats`, o `explain` e a rejeição do documento inválido. Use apenas dados de demonstração. Não projete tokens, senhas, strings de conexão ou dados pessoais.

Se precisarem criar ou editar dados ao vivo, use uma cópia descartável da stack. Para disparar um alerta, siga a instrução isolada em [PLANO.md](PLANO.md); não altere o volume principal.

### Fala de 1 minuto: conclusão

Resuma o custo incremental zero da execução local, o processamento assíncrono e as limitações: polígonos sintéticos e clima medido na estação próxima, que não representa medições dentro do campus. A demonstração não depende de hospedagem externa; as capturas reais estão em `docs/evidencias/`. Como trabalhos futuros, cite a autenticação dedicada de dispositivos, a ingestão por gateway e a avaliação com uma carga de dados maior.

## Se algo falhar

- Se a stack estiver parada, execute `make demo` e aguarde a conclusão; evite reiniciar serviços no meio da apresentação.
- Se o mapa não carregar o fundo, confirme a conexão com a internet. Os dados dos talhões ainda podem ser explicados pela lista e pelo GeoJSON.
- Se o painel climático não tiver dados recentes, mantenha o ano importado selecionado; não crie nem apresente observações sintéticas como se fossem do INMET.
- Se `/docs` ou os dados do MongoDB não responderem, continue pelo painel e explique que as evidências detalhadas estão em `docs/evidencias/` e `docs/MODELO-DADOS.md`.
- Antes da apresentação, consulte o run mais recente do PR #1 e confirme que todos os jobs passaram. A captura 28 registra um run histórico e não substitui o status atual da branch.

## Fechamento

Finalize retomando os limites do protótipo: localização única no campus, polígonos sintéticos, dados climáticos oficiais da estação próxima e comparação de produção regional. Convide perguntas sobre modelagem documental, séries temporais, índices geoespaciais, validação e processamento assíncrono.
