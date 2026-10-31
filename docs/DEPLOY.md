# Publicação opcional sem custo

## Regra de custo

A execução local é o caminho principal e sempre pode ser reproduzida com Docker Compose. A publicação externa é opcional e serve para demonstrações acadêmicas em melhor esforço; não oferece operação contínua, SLA, backups garantidos ou suporte. Use somente recursos que continuem gratuitos dentro das cotas. Não inicie teste pago, não faça upgrade e não informe cartão ou outro meio de pagamento. Se algum provedor exigir isso para criar ou manter a conta, pare e use a demonstração local.

Os limites mudam. Conferimos as páginas oficiais em 31/10/2026; releia [Render Free](https://render.com/docs/free), [Atlas Free](https://www.mongodb.com/docs/atlas/reference/free-shared-limitations/) e [Vercel Hobby](https://vercel.com/docs/plans/hobby) imediatamente antes de qualquer publicação. A Render encerra serviços gratuitos após 15 minutos sem tráfego, oferece 750 horas mensais compartilhadas por workspace e não oferece disco persistente. Se o workspace tiver meio de pagamento cadastrado, uso adicional de banda/build pode gerar cobrança; sem meio de pagamento, a plataforma suspende serviços ou builds ao atingir os limites. Para manter o custo em R$ 0, não cadastre nem use cartão ou outro meio de pagamento e aceite a suspensão se as cotas acabarem. O Atlas Free limita armazenamento a 0,5 GB, transferência a 10 GB em cada direção por janela móvel de sete dias e 100 operações por segundo; pode pausar após 30 dias sem conexões. O Atlas Free usa MongoDB 8.0; a stack local e o CI deste repositório usam MongoDB 7, então valide o schema nesse tier antes de qualquer publicação. O plano Hobby da Vercel é gratuito para uso pessoal e não comercial, dentro das cotas. Nenhum desses planos garante 24/7. Não use esta configuração para dados sensíveis ou operação comercial.

## Arquitetura de demonstração

O caminho de nuvem documentado no guia é Atlas Free + uma instância Web Free da Render + Vercel Hobby:

- Atlas guarda os dados fora do container efêmero.
- [`render.yaml`](../render.yaml) configura uma instância Docker gratuita da API. O [`Dockerfile.render`](../Dockerfile.render) combina API, simulador, avaliação/notificação de alertas e rollup num container, pois a instância gratuita é um serviço Web e hiberna quando não recebe tráfego.
- A Vercel hospeda `apps/web`. `NEXT_PUBLIC_API_URL` é uma variável de build; alterá-la exige uma nova compilação do front.

A configuração de Blueprint desativa deploy automático. Ela não cria recursos por si só: a criação de contas, a conexão do repositório e qualquer publicação continuam sendo ações manuais do responsável pelo projeto. Este repositório não contém credenciais e esta tarefa não publicou serviços.

## Preparar o banco

1. Crie apenas um cluster Atlas Free, se o cadastro puder ser feito sem cartão e sem ativar trial. Se houver solicitação de cartão, interrompa.
2. Aplique `infra/mongo/02-schema.js` usando os privilégios temporários necessários para criar as coleções, índices, validações e TTL. Reduza/remova o usuário temporário depois; a aplicação deve usar um usuário separado com `readWrite` somente no banco `agropulse`.
3. Confirme no Atlas que `sensor_readings` foi criada como time series e que o TTL está ativo. Os recursos do tier podem limitar comandos de administração; se o schema não for aceito, não prossiga para a publicação e use MongoDB local.
4. A allowlist do Atlas pode exigir acesso de rede amplo para um serviço com IP de saída dinâmico. Nesse caso, use senha exclusiva e forte, usuário limitado ao banco, TLS, dados fictícios e limite a exposição ao período de demonstração. Nunca abra usuário administrativo para a aplicação.

O padrão de retenção hospedado é 30 dias e a simulação grava a cada 60 segundos. O Atlas Free aceita até 512 MB somando dados e índices; acompanhe o consumo e mantenha a carga pequena. Os dados dos talhões e sensores são sintéticos. A demonstração local inclui 1.556 documentos regionais da PAM/SIDRA de São Paulo e 8.784 observações da estação INMET A763 para 2024. Não carregue esses conjuntos em um cluster gratuito sem conferir antes o espaço disponível; importações maiores do INMET são opcionais e podem aumentar significativamente o volume.

## Preparar API e workers na Render

1. Revise o Blueprint da raiz do repositório. Ele define `MONGO_URI` como segredo a informar no painel, gera `JWT_SECRET`, aponta o health check para `/health` e mantém o deploy automático desativado.
2. No painel da Render, importe o repositório e selecione o Blueprint. Escolha somente o plano Free. Confira o resumo de custo antes de confirmar; pare se aparecer cobrança, cartão, trial ou upgrade.
3. Informe `MONGO_URI` do usuário restrito do Atlas no painel de segredos. Não a coloque no repositório, no histórico do shell, em issue, relatório ou screenshot. Deixe `ALERT_WEBHOOK_URL` vazio para usar os logs como canal de demonstração.
4. Após configurar a origem do front na Vercel, troque `CORS_ORIGINS` para a origem exata exibida por aquele projeto. Não use `*` em um site público.
5. Acompanhe `/health`, `/docs` e os logs. O supervisor reinicia processos encerrados e trata SIGTERM; ele não recupera a disponibilidade durante hibernação nem substitui monitoramento.

A imagem inicia API, simulador, avaliador de regras e rollup diário. O simulador espera sensores ativos; não há conta/senha de demonstração criada automaticamente em uma instância pública. Cadastre o primeiro usuário pela tela de registro. Para carregar dados sintéticos, conecte um comando local ao Atlas com a connection string lida em prompt, sem gravá-la em arquivo:

```bash
read -s MONGO_URI
export MONGO_URI
docker compose run --rm --no-deps -e MONGO_URI -e MONGO_DB=agropulse api python -m app.seed --fields 4 --sensors-per-field 3
docker compose run --rm --no-deps -e MONGO_URI -e MONGO_DB=agropulse simulator python -m workers.simulator --backfill-days 7 --step-minutes 5
unset MONGO_URI
```

Execute esse procedimento somente depois de conferir a connection string e o cluster de destino. O segundo comando pode inserir dezenas de milhares de leituras. Para restaurar uma base de demonstração limpa, apague os documentos de teste pelo Atlas ou use um cluster novo; não execute `down -v` esperando que isso remova dados do Atlas.

## Preparar o front na Vercel

1. Importe o repositório e configure `apps/web` como Root Directory.
2. Defina `NEXT_PUBLIC_API_URL` com a URL pública da API, sem barra final, no ambiente de Preview/Production usado pela demonstração.
3. Confirme o plano Hobby e seus limites de uso. Se exigir pagamento, trial ou upgrade, cancele o fluxo e use o front local.
4. Depois da primeira publicação, atualize `CORS_ORIGINS` na Render com a URL exata do front.

O plano Hobby só deve ser usado para fins pessoais/não comerciais conforme os termos atuais da Vercel. Para a atividade acadêmica, mantenha a publicação limitada à demonstração e às cotas gratuitas.

## Desenvolvimento e recuperação local

```bash
make demo
```

O comando inicia a stack integrada e aplica o seed idempotente para a demonstração. `make setup` é opcional e apenas cria `.env` local a partir do exemplo para personalizações; sem ele, os valores padrão mantêm a demonstração local. Para iniciar sem reaplicar o seed, use `make up`.

Para simular reinício dos workers sem apagar dados, use `docker compose restart simulator alerts`. Para encerrar a stack local, rode `make down`. Isso preserva o volume. `docker compose down -v` remove os dados locais e só deve ser usado quando a exclusão for intencional.

Para conferir a imagem única sem publicá-la:

```bash
docker build -f Dockerfile.render -t agropulse-render:local .
```

## Limites e respostas a falhas

- A Render hiberna uma Web Service Free após 15 minutos sem tráfego de entrada; a próxima requisição pode levar cerca de um minuto para responder. Durante a hibernação, o simulador e o avaliador de alertas também param. Um monitor externo só pode reduzir períodos ociosos se permitido pelos termos do provedor e não cria garantia de disponibilidade.
- A cota de horas da Render é compartilhada pelo workspace; ao esgotá-la, serviços Free podem ser suspensos até o próximo mês. Limites de tráfego/build também podem suspender o serviço.
- O filesystem da Render é efêmero. Estado e uploads precisam ficar no Atlas ou em outro armazenamento explicitamente aprovado e gratuito; este projeto não grava dados persistentes no container.
- O Atlas Free tem teto rígido de armazenamento. Se leituras falharem por falta de espaço, diminua sensores, frequência e retenção, remova imports desnecessários ou volte à base local. Não aceite upgrade automático.
- O processo pode reiniciar. O simulador recupera no máximo sete dias de lacuna por sensor; alertas pendentes são recuperados na inicialização; o rollup reprocessa a janela de sobreposição.
- Sem webhook, alertas ficam registrados no banco/log e aparecem no painel. Integração com e-mail ou mensageria requer endpoint/conta próprios e está fora do caminho obrigatório sem custo.

## Exclusões financeiras

Oracle Cloud não faz parte do caminho recomendado: o guia informa que a verificação/cadastro pode exigir cartão. Nenhuma configuração deste repositório autoriza criar conta, informar cartão, aceitar trial pago, provisionar recurso, fazer deploy ou contratar domínio. A alternativa garantida para manter custo de hospedagem em R$ 0 é executar localmente.
