# Roteiro da apresentação do AgroPulse

Roteiro de apoio para a demonstração acadêmica da atividade IAL-215. Ajuste a duração e a divisão de falas ao tempo definido pelo professor.

O [deck da apresentação (PPTX)](apresentacao/AgroPulse-IAL-215.pptx) tem seis slides alinhados à divisão sugerida abaixo e pode ser aberto localmente no dia da demonstração.

## Mensagem central

O AgroPulse mantém um diário operacional auditável por talhão e relaciona registros de manejo com alertas e telemetria. O caso demonstrativo é investigar um alerta, registrar uma irrigação e comparar a média de umidade dos sensores nas 24 horas antes e depois. Essa leitura é temporal; não comprova que a irrigação causou a variação nem recomenda horário ou lâmina.

A demonstração pode ser executada localmente sem custo incremental. Sua referência espacial é somente o campus da Fatec Pompéia. A fazenda demonstrativa tem três polígonos sintéticos próximos ao campus; eles mostram operações geoespaciais e não representam talhões reais. As leituras também são sintéticas. O clima é de uma estação INMET a 27,8 km e serve apenas como contexto regional.

## Preparação antes da apresentação

1. Na raiz do repositório, execute `make demo` e aguarde os importadores e o rollup terminarem.
2. Confira os serviços com `docker compose ps`. A stack integrada usa a interface em `http://localhost:3000`, a API em `http://localhost:8000/docs` e o MongoDB em `localhost:27017`.
3. Abra a interface e entre com a conta de demonstração descrita no README. Não projete nem inclua a senha em capturas.
4. Confirme que o painel mostra uma fazenda, três talhões, leituras de sensores, ranking PAM/SIDRA e o ano climático importado mais recente. No conjunto versionado, o ano disponível é 2024.
5. Para mostrar a comparação pós-irrigação, registre uma irrigação fictícia no talhão selecionado com data entre 24 horas e sete dias antes da apresentação. `make demo` gera leituras sintéticas para esse período; marque a operação como fictícia e deixe os dados de sensores identificados como simulados.
6. Deixe aberto o README, o Swagger e [as consultas MongoDB para o relatório](MODELO-DADOS.md). Não execute `make reset` durante a preparação: esse comando apaga os volumes locais.

## Vídeo curto de contingência

O [vídeo de demonstração](apresentacao/demonstracao-agropulse.mp4) está pronto para uso offline. É uma gravação contínua e silenciosa de 44 segundos da aba local do AgroPulse no Chrome, codificada em H.264 e 1920 × 972. Os trechos verificados mostram a visão geral, o mapa de talhões e os sensores, sem credenciais nem elementos de outras aplicações. Alertas são mostrados na captura 08 e na demonstração interativa. A apresentação principal continua sendo a demonstração da stack local.

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

Explique que o responsável precisa consultar registros de manejo e sinais de sensores para entender o que está acontecendo em cada talhão. O AgroPulse registra a atividade, quem a executou, a área, os custos e os comprovantes. A demonstração usa apenas polígonos e leituras sintéticas próximos ao campus da Fatec; não representa áreas reais.

### Fala de 3 minutos: arquitetura e MongoDB

Apresente o fluxo Next.js → FastAPI → MongoDB e os workers de simulação, importação, alertas e rollup. Destaque documentos para cadastros, coleção time series para leituras, GeoJSON com índice `2dsphere`, validação do schema e agregação diária com `$merge`.

### Fala de 3 minutos: demonstração da interface

Entre com a conta de demonstração descrita no README. Mostre um alerta e o diário de operações com origem, autoria e comprovantes. No painel “Resposta observada após irrigação”, compare as médias por sensor antes e depois do registro e os tamanhos das amostras. Reforce que a telemetria do demo é simulada e que a comparação temporal não demonstra causalidade. Apresente o histórico oficial de 2024 da estação A763/Marília, a 27,8 km, somente como contexto regional, e o ranking PAM/SIDRA de São Paulo como comparação municipal.

### Fala de 3 minutos: demonstração no Compass

Use as consultas de [MODELO-DADOS.md](MODELO-DADOS.md) para mostrar `sensor_readings` e o TTL, o índice `2dsphere`, `$geoIntersects` no ponto do campus, média diária, `field_daily_stats`, o `explain` e a rejeição do documento inválido. Use apenas dados de demonstração. Não projete tokens, senhas, strings de conexão ou dados pessoais.

Se precisarem criar ou editar dados ao vivo, use uma cópia descartável da stack. Para disparar um alerta, siga a instrução isolada em [PLANO.md](PLANO.md); não altere o volume principal.

### Fala de 1 minuto: conclusão

Resuma que o AgroPulse registra operações com trilha de auditoria e ajuda a interpretar alertas no contexto da atividade realizada. Declare os limites: telemetria e polígonos sintéticos, clima medido numa estação distante e ausência de validação agronômica. Como evolução, proponha relacionar alertas à ação tomada, incluir chuva medida na propriedade e validar a comparação com dados reais.

## Se algo falhar

- Se a stack estiver parada, execute `make demo` e aguarde a conclusão; evite reiniciar serviços no meio da apresentação.
- Se o mapa não carregar o fundo, confirme a conexão com a internet. Os dados dos talhões ainda podem ser explicados pela lista e pelo GeoJSON.
- Se o painel climático não tiver dados recentes, mantenha o ano importado selecionado; não crie nem apresente observações sintéticas como se fossem do INMET.
- Se `/docs` ou os dados do MongoDB não responderem, continue pelo painel e explique que as evidências detalhadas estão em `docs/evidencias/` e `docs/MODELO-DADOS.md`.
- Antes da apresentação, consulte o run mais recente do PR #1 e confirme que todos os jobs passaram. A captura 28 registra um run histórico e não substitui o status atual da branch.

## Fechamento

Finalize retomando o recorte: diário de campo auditável por talhão, com telemetria e alertas configuráveis. Reforce que o demo usa localização e leituras sintéticas, e que a comparação antes/depois não é recomendação agronômica nem validação em campo. Convide perguntas sobre modelagem documental, séries temporais, índices geoespaciais, agregações e processamento assíncrono.
