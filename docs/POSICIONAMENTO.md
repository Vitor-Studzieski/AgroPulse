# Posicionamento do AgroPulse

Nota de produto atualizada em 4 de novembro de 2026. O AgroPulse permanece no domínio agrícola, com foco no acompanhamento operacional por talhão.

## Referência competitiva

O material público do SinalTerra descreve uma plataforma para validar produtos agrícolas a partir de dados de testes de campo, processamento por sensoriamento remoto, imagens de satélite e mapas de alta resolução. Essa descrição pública não permite auditar todas as funcionalidades do produto.

| | SinalTerra, segundo o material público | AgroPulse, recorte proposto |
|---|---|---|
| Trabalho central | Analisar dados de ensaios e validar produtos agrícolas | Registrar operações executadas e investigar alertas no contexto do manejo |
| Evidência principal | Dados de campo processados com sensoriamento remoto e imagens de satélite | Histórico de atividades por talhão, telemetria local, comprovantes, custos e autoria |
| Usuário principal | Equipes de ensaio e análise de produtos agrícolas, além de produtores e agrônomos que usam a análise remota | Responsáveis por executar e acompanhar operações agrícolas |
| Pergunta que apoia | Como se comportou o produto avaliado no ensaio? | O que foi feito neste talhão e o que mudou depois da operação? |

Fonte: [site do SinalTerra](https://sinalterra.com/). A comparação usa o posicionamento publicamente descrito e não afirma que funcionalidades não mencionadas estejam ausentes.

## Recorte escolhido

O AgroPulse organiza a execução da rotina de campo. Uma operação pode registrar tipo, data e hora, área trabalhada, responsável, equipamento, custos por categoria, dados específicos da atividade e arquivos de comprovação. O registro indica se é real ou fictício; alterações ficam no histórico de auditoria.

**Frase de posicionamento:** AgroPulse mantém um diário de campo auditável por talhão e ajuda o responsável a relacionar operações executadas com alertas e telemetria.

O diferencial central não é apenas exibir sensores. É preservar a sequência **alerta → investigação → ação registrada com evidência → acompanhamento da resposta**. A interface trata os registros de operação, custos, origem real ou fictícia, anexos e autoria. No painel de operações, a comparação “Resposta observada após irrigação” agrupa a umidade média por sensor nas 24 horas anteriores e posteriores ao evento e mostra a quantidade de sensores e leituras usadas.

## O que o protótipo entrega

- Cadastro de fazendas, talhões, safras, operações, sensores e regras de alerta.
- Registro de operações com custos, área, responsável, equipamento, comprovantes e histórico de alterações.
- Separação entre registros reais e fictícios, para não apresentar a demonstração como evidência de uma atividade real.
- Consulta de leituras e séries temporais de sensores e alertas por regras.
- Comparação temporal de umidade antes e depois de operações de irrigação registradas.
- Consulta climática do INMET e comparação municipal da PAM/SIDRA.

Na demonstração, leituras e polígonos são sintéticos. A estação A763/Marília fica a cerca de 27,8 km do campus da Fatec Pompéia e oferece contexto regional, não medições do talhão. A comparação pós-irrigação descreve associação temporal e não estima efeito causal nem eficácia agronômica.

## Próximo diferencial a implementar

Próximas etapas para cada irrigação registrada:

1. ligar a operação ao alerta ou à condição que levou à inspeção;
2. incluir observações de chuva local, quando houver medição na propriedade;
3. validar a leitura com dados reais de campo e avaliar quais janelas são úteis para os responsáveis.

Essa tela deve descrever uma associação temporal observada. Ela não deve afirmar que a irrigação causou a variação nem recomendar volume ou horário sem dados locais e validação agronômica. Métricas de economia de água, produtividade ou eficácia precisam de um estudo com uma propriedade parceira.

## Limite de diferenciação

Um trabalho publicado pela própria Fatec Pompéia descreve monitoramento da horta com sensores de umidade, temperatura e luminosidade e irrigação autônoma. Isso mostra que “usar sensores para monitorar umidade e irrigar” isoladamente não distingue o AgroPulse dentro da faculdade. O recorte operacional precisa permanecer explícito: registrar atividades executadas e evidências por talhão e acompanhar o que ocorreu depois, sem automatizar a irrigação.

Fonte: [*Monitoramento Inteligente de Irrigação para Hortas e Plantações*, Revista InterAgro, 2024](https://publicacoescgesg.cps.sp.gov.br/interagro/article/download/449/873/1494).

## Linguagem recomendada

Use “diário de campo auditável”, “rastreabilidade de operações por talhão”, “alertas por regras configuradas” e “resposta observada após a operação”. Evite chamar o conceito de inédito ou afirmar que a plataforma valida produtos agrícolas por satélite, recomenda irrigação ou comprova efeitos agronômicos sem dados e avaliação de campo.
