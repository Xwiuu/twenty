# Jean Digital — Setup local (Sprint 00)

Fork do [Twenty](https://github.com/twentyhq/twenty). Guia oficial: `CLAUDE.md` e https://docs.twenty.com. Este arquivo só registra o que é específico daqui.

## Base

- Fork: https://github.com/Xwiuu/twenty (`origin`); `upstream` = `twentyhq/twenty`.
- Versão-base: tag `v2.9.0` (`b53f1832d80f87be2cfd88990b855c0e5f3cc926`).
- Licença original preservada (`LICENSE` na raiz). Não remover avisos legais.

## Pré-requisitos

- Node `^24.5.0` (testado com 24.19.0), Yarn `4.13.0` (via Corepack/`packageManager`).
- Docker + Docker Compose (Postgres 16 e Redis 7).

## Instalação e início

```bash
yarn install --immutable                       # lento em disco NTFS (~27 min); não interromper
bash packages/twenty-utils/setup-dev-env.sh    # sobe Postgres+Redis, cria bancos, copia .env
npx nx run twenty-server:database:reset        # primeira vez: migra e popula dados de dev
yarn start                                     # frontend + backend + worker
```

`.env` é ignorado pelo git (`**/**/.env`). Nada de segredo é versionado.

## Parar

- `Ctrl+C` no `yarn start`.
- `bash packages/twenty-utils/setup-dev-env.sh --down` para Postgres/Redis.

## URLs locais

- Frontend: http://localhost:3001 (na tela de login, "Continue with Email" com credenciais pré-preenchidas)
- Backend/GraphQL: http://localhost:3000

## Validação

```bash
npx nx lint:diff-with-main twenty-front
npx nx lint:diff-with-main twenty-server
npx nx typecheck twenty-front
npx nx typecheck twenty-server
```

Resultados reais da Sprint 00 estão na descrição do PR.

## Problemas conhecidos

- **`node_modules` corrompido se o `yarn install` for interrompido.** Sintoma: `TS7016`/`TS2307` em `@linaria/core` e `@tabler/icons-react` no build do `twenty-ui`. Correção: apagar `node_modules` e reinstalar sem interromper.
- O projeto está em NTFS (`ntfs3`), o que deixa o link do Yarn muito lento. Mover para ext4 acelera.
- O commit-base `5017129f` é um commit único, sem histórico em comum com a tag `v2.9.0`, e já inclui `apps/web` e `infra/twenty` (fora do escopo da Sprint 00). Ver pendências no PR.

## Onde customizar (caminho de menor esforço, nada implementado)

| Necessidade | Caminho |
|---|---|
| Identidade visual | Tokens de tema em `packages/twenty-ui/src/theme`; logo/ícones em `packages/twenty-front/public`. |
| Interesses em imóveis/veículos | Campos customizados criados pela UI de Settings → Data model (sem alterar código), ou via API de metadata. |
| Pipeline comercial | Estágios do objeto Opportunity, editáveis em Settings → Data model. |
| Navegação simplificada | Ocultar objetos/itens em Settings e nas views; evitar remover módulos. |
| Formulários externos | API REST/GraphQL do Twenty (`packages/twenty-server/src/engine/api/rest` e `graphql`) com API key criada em Settings → APIs. |

## Ao customizar no futuro

Use `git fetch upstream --tags` para acompanhar o Twenty; mantenha mudanças isoladas para facilitar merge de upstream.
