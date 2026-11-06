# Proposta de diferenciação do AgroPulse

Rumo definido em 4 de novembro de 2026: manter o acompanhamento agrícola por talhão e tornar o fluxo operacional mais específico.

## Diferença em relação ao SinalTerra

O SinalTerra apresenta publicamente uma solução de análise de dados de testes de campo com sensoriamento remoto, imagens de satélite e mapas para validação de produtos agrícolas. O AgroPulse deve se concentrar em outro trabalho: preservar o que foi executado em cada talhão e ajudar o responsável a investigar alertas e acompanhar a resposta observada após uma operação.

## Proposta de valor

**AgroPulse é o diário de campo auditável que liga alertas, atividades comprovadas e telemetria por talhão.**

Uma operação registra data e hora, área, responsável, equipamento, custos, parâmetros específicos — como método e lâmina informados na irrigação — e comprovantes. O histórico de autoria e alterações permite explicar quando o registro foi feito e o que mudou.

## Funcionalidade diferencial

A visão “Resposta observada após irrigação” reúne:

- leituras de umidade nas janelas anteriores e posteriores à operação;
- dados declarados da irrigação, com origem real ou fictícia claramente identificada;
- alerta associado, quando houver;
- responsável, observações e anexos;
- variação observada e quantidade de leituras usadas no cálculo.

O resultado descreve uma relação temporal. Não atribui causalidade à irrigação e não recomenda lâmina ou horário.

## Plano de implementação por prioridade

1. Consolidar o diário de operações auditável e a identificação real/fictícia já em desenvolvimento.
2. A comparação temporal de umidade antes/depois da irrigação está disponível no painel de operações.
3. Relacionar cada irrigação ao alerta ou à observação que motivou a ação e adicionar chuva local quando houver medição.
4. Validar a leitura com dados locais de uma propriedade parceira antes de anunciar benefício agronômico.

O prazo acadêmico registrado no [plano do grupo](PLANO.md) é 16/11/2026. O MVP da disciplina pode demonstrar o fluxo com registros sintéticos identificados como fictícios; validação em lavoura permanece uma etapa posterior.
