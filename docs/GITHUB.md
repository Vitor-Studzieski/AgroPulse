# Fluxo de integração no GitHub

## Trabalho por frente

Crie uma branch e worktree por tarefa, partindo de `main` atualizado:

```bash
git fetch origin
git worktree add ../agropulse-api -b feature/api origin/main
git worktree add ../agropulse-web -b feature/web origin/main
git worktree add ../agropulse-workers -b feature/workers origin/main
```

Cada agente trabalha somente no diretório indicado em [`AGENTS.md`](../AGENTS.md). Na frente web, rode a Mock API isolada; a API e os workers têm manifests e bancos separados. Abra um pull request por frente para que o CI rode em paralelo e revise os contratos entre camadas antes do merge.

## Proteger `main`

O workflow `.github/workflows/ci.yml` executa os jobs obrigatórios `api`, `workers`, `web`, `schema` e `compose`. Configure uma regra de branch no GitHub para `main`:

1. Exigir pull request antes de mesclar.
2. Exigir todos os checks acima, sem permitir ignorar resultados pendentes.
3. Exigir branch atualizada com `main` antes do merge.
4. Bloquear force push e exclusão da branch.

Essa proteção é uma configuração da conta/repositório do GitHub; o workflow local não consegue ativá-la. Confira os nomes de checks exibidos no GitHub depois da primeira execução do Actions.

## CI

O workflow instala dependências e roda Ruff + pytest para API e workers, valida a sintaxe do gerador da amostra PAM versionada, compila o Next.js, aplica o schema num MongoDB limpo e confirma as coleções time series, TTL, índices essenciais, `IXSCAN` com índice explícito e rejeição de documentos inválidos. Também valida todos os manifests Compose e constrói a imagem única da Render sem publicá-la. Ele roda em qualquer push e em pull requests. Não há job de deploy; a publicação é manual e opcional.
