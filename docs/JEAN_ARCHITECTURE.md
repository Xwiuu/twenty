# Jean Digital — Arquitetura e plano de customização (Sprint 00)

Base: fork de `twentyhq/twenty` na tag **v2.9.0** (commit `da2eac833a5a30fa9a437aaaea2e2d7bfb099793`; objeto de tag `b53f1832d80f87be2cfd88990b855c0e5f3cc926`).
Remotos: `origin` = `Xwiuu/twenty` (fork), `upstream` = `twentyhq/twenty` (somente leitura). Não há atualização automática.

> Este documento descreve o que foi observado no código. Nada aqui foi implementado nesta sprint.

## 1. Monorepo

Nx + Yarn 4.13 (`nodeLinker: node-modules`, `enableScripts: false`, `enableHardenedMode`). Node `^24.5.0` (ver `engines`; testado com 24.19.0).

| Pacote | Papel | Relevância para o Jean |
|---|---|---|
| `packages/twenty-server` | NestJS + TypeORM + GraphQL/REST, BullMQ worker | Alta (API, metadados, seeds) |
| `packages/twenty-front` | React 18 + Jotai + Linaria + Vite | Média (branding, textos) |
| `packages/twenty-shared` | Tipos/utilitários comuns (build obrigatório antes dos demais) | Baixa |
| `packages/twenty-ui` | Componentes e tokens de tema | Baixa (tema) |
| `packages/twenty-emails` | Templates React Email | Baixa (e-mails transacionais) |
| `packages/twenty-sdk`, `twenty-client-sdk`, `twenty-apps`, `create-twenty-app` | SDK de "apps" do Twenty (extensões por manifesto) | **Alta para extensões futuras** |
| `packages/twenty-docker` | Compose/Helm/K8s oficiais | Referência para deploy (sprint futura) |
| `packages/twenty-website`, `twenty-docs`, `twenty-zapier`, `twenty-e2e-testing`, `twenty-companion`, outros | Site/documentação/integrações do upstream | Ignorar |

Diretórios que **não** existem no upstream v2.9.0 e já estavam no commit de fundação (`5017129f`): `apps/web` (scaffold `create-next-app`, Next 16 / React 19, fora dos workspaces Yarn, com `package-lock.json` próprio), `infra/twenty` (compose de produção baseado na imagem oficial), `docs/decisions` (vazio). Ver seção 8.

## 2. Backend (`packages/twenty-server/src`)

- `engine/api/{graphql,rest,mcp,common}`: GraphQL (core + metadata) e REST gerados dinamicamente a partir dos metadados do workspace; MCP embutido.
- `engine/core-modules/*`: auth, user, workspace, api-key, billing, sso, feature-flag, twenty-config, file-storage, etc. (esquema `core`).
- `engine/metadata-modules/*` + `engine/workspace-manager`: objetos/campos/views definidos em **metadados**, materializados em um schema Postgres por workspace.
- `modules/*`: lógica dos objetos padrão (`person`, `company`, `opportunity`, `task`, `note`, `messaging`, `calendar`, `workflow`...).
- `database/commands/upgrade-version-command`: comandos de upgrade (instance/workspace). Convenção do upstream: gerar via `database:migrate:generate`.
- Workers: `nx run twenty-server:worker` (BullMQ/Redis). Necessário para jobs, e-mail sincronizado, etc.

## 3. Frontend (`packages/twenty-front`)

Vite, porta de dev **3001**; fala com o servidor em **3000**. Módulos por domínio em `src/modules` (`object-record`, `views`, `navigation-menu-item`, `settings`, `auth`, `activities`...). Estilo com Linaria; i18n com Lingui (`src/locales`). Idioma/pt-BR já existe via locales. Branding estático: `index.html` (título, og/twitter), `public/images`, `public/manifest.json`.

## 4. Autenticação

`engine/core-modules/auth` + `jwt` + `user-workspace`. E-mail/senha habilitado por padrão (`AUTH_PASSWORD_ENABLED`), Google/Microsoft/SSO opcionais via env. Em dev, `SIGN_IN_PREFILLED=true` pré-preenche credenciais seed (usar "Continue with Email"). **Não modificar** nesta fase. Para integração externa (site → CRM) usar **API key** de workspace (`core-modules/api-key`), sem tocar em auth.

## 5. Modelo de dados e extensibilidade

Objetos padrão: `Person`, `Company`, `Opportunity`, `Task`, `Note`, `WorkspaceMember`, etc., definidos em `engine/workspace-manager/twenty-standard-application/utils/field-metadata/compute-*-standard-flat-field-metadata.util.ts`. `Opportunity.stage` já é SELECT com `NEW → SCREENING → MEETING → PROPOSAL → CUSTOMER`.

Objetos e campos **customizados** são criados em runtime (UI em *Settings → Data model* ou API de metadados) e ficam apenas no workspace — **sem migration nem alteração de código**. Isso é o caminho preferido para o Jean. Seeds de desenvolvimento: `workspace-manager/dev-seeder`; dados iniciais de workspace novo: `standard-objects-prefill-data`.

Views (Kanban/tabela/filtros), navegação lateral (`standard-navigation-menu-item.constant.ts`, mas editável por workspace na UI), papéis/permissões e workflows são configuráveis na UI.

## 6. APIs

- GraphQL: `/graphql` (dados) e `/metadata` (esquema). REST: `/rest/*` e OpenAPI gerado por workspace. Webhooks e API keys em *Settings → APIs & Webhooks*.
- Para captação de leads futura: `POST /rest/people` (+ `/rest/opportunities`) com API key é suficiente — sem backend novo.

## 7. Docker e deploy (referência, não executado)

- Dev: `packages/twenty-docker/docker-compose.dev.yml` (Postgres + Redis) via `packages/twenty-utils/setup-dev-env.sh`.
- Prod: `packages/twenty-docker/docker-compose.yml` e `infra/twenty/docker-compose.yml` (imagem `twentycrm/twenty`). Segredos: `ENCRYPTION_KEY`/`APP_SECRET` obrigatórios fora do dev.

## 8. Licenças e avisos

- Licença do repositório: **AGPL-3.0** (`LICENSE`), com **exceção comercial**: arquivos marcados `/* @license Enterprise */` (ex.: `engine/core-modules/enterprise/*`) **não são AGPL** e exigem licença comercial do upstream. Não copiar, redistribuir ou habilitar funcionalidades Enterprise sem licença. Preservar todos os cabeçalhos e o `LICENSE`.
- AGPL §13: se o CRM modificado for oferecido via rede a terceiros, o código-fonte modificado deve ser disponibilizado aos usuários. Para uso interno do Jean, o risco é baixo; para oferta comercial (SaaS), requer atenção.
- Marca "Twenty": ao rebrandear, remover/substituir logos e nome visíveis, mas manter avisos de copyright/licença no código.

## 9. Testes e requisitos locais

- Unit: Jest (`npx jest <arquivo> --config=packages/<pkg>/jest.config.mjs`); Storybook no front; integração do servidor exige DB (`test:integration:with-db-reset`); E2E Playwright em `twenty-e2e-testing`.
- Requisitos: Node 24.x, Yarn 4.13 (via `.yarn/releases`), PostgreSQL 16 + Redis 7 (Docker ou locais). Variáveis em `packages/twenty-server/.env` (gitignored, modelo `.env.example`). Ver `docs/JEAN_LOCAL_SETUP.md`.

## 10. Onde customizar para o Jean (sem quebrar upstream)

Regra: **configuração > app/extensão > código no núcleo**. Cada alteração no núcleo aumenta o custo de merge com o upstream.

| Necessidade | Caminho | Código? |
|---|---|---|
| Contatos | `Person` (+ `Company` opcional) nativos | Não |
| Interesse imóvel/veículo | Campo SELECT customizado em `Person` e/ou `Opportunity` (Settings → Data model) | Não |
| Pipeline comercial | `Opportunity.stage` + view Kanban; renomear/ajustar opções na UI | Não (se aceitar os estágios nativos); ajustar opções = configuração de campo |
| Atividades e retornos | `Task` (com data de vencimento) e `Note` nativos, vinculados a Person/Opportunity | Não |
| Origem do lead | Campo SELECT customizado `origem` em `Person` | Não |
| Captação via site/blog | Site chama REST com API key | Código **fora** do núcleo (app do site) |
| Branding (nome, logo, título) | `index.html`, `public/images`, tema em `twenty-ui` | Sim, pequeno e isolado |
| Campos/estágios pré-criados em workspace novo | Script de provisionamento via API de metadados (ou seed) | Sim, isolado (script próprio) |
| Remover módulos (e-mail, calendário, workflows) | Ocultar por navegação/permissões/feature flags | Não — **não remover código** |

## 11. Site e blog (proposta mínima, não implementada)

O commit de fundação traz `apps/web` (scaffold Next.js limpo). Proposta: manter o site **fora** dos workspaces Yarn do Twenty (como já está, com lockfile próprio), em `apps/web`, implantado de forma independente; consumir o CRM só por HTTP (REST + API key em variável de ambiente do servidor, nunca no cliente). Blog como arquivos MDX no próprio `apps/web` (sem CMS) e SEO via `metadata`/`sitemap` do Next. Isso evita acoplar dependências (React 19/Next 16 vs React 18 do front do Twenty) e não altera o build do CRM. Decisão final fica para a Sprint 01+.
