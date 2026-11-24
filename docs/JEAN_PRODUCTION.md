# Jean CRM — preparação para produção (Sprint 02.7)

Este documento **prepara e certifica** a implantação. Nada foi publicado. Base: Twenty `v2.9.0`, um workspace, operações Jean Imóveis e Jean Veículos.

> Escopo de segurança/LGPD abaixo é o mínimo técnico do MVP, não parecer jurídico.

## 1. Inventário (Gate 0)

| Item | Situação |
|---|---|
| Código | `jean/v2.9.0`. Em relação à tag `v2.9.0` do Twenty só existem arquivos novos em `scripts/`, `docs/` e `infra/`: **nenhum arquivo do Twenty foi alterado**. Por isso a produção usa a **imagem oficial `twentycrm/twenty:v2.9.0`** (tag existente no registro), sem build próprio. |
| Serviços efetivos | `server` (API + frontend na porta 3000), `worker` (BullMQ), PostgreSQL 16, Redis 7. Mais o Caddy (HTTPS). Nada de ClickHouse nem de outros serviços. |
| Armazenamento | Banco: volume `db-data`. Arquivos (anexos/imagens): volume `server-local-data` (`STORAGE_TYPE=local`). S3 é opcional e não é usado. |
| Portas | Publicadas: **80 e 443** (Caddy). Internas: 3000 (server), 5432, 6379. |
| Segredos obrigatórios | `ENCRYPTION_KEY`, senha do PostgreSQL. (`APP_SECRET` é legado.) |
| URL pública | `SERVER_URL=https://<domínio>` |
| E-mail | `EMAIL_DRIVER=smtp` + host/porta/usuário/senha. Com o driver padrão (`logger`) **nenhum e-mail é enviado** (convites e recuperação de senha). |
| Memória medida | Servidor sozinho, ocioso, em ambiente isolado: ~620 MB; PostgreSQL ~115 MB; Redis ~9 MB (o worker soma mais). |

**Requisitos recomendados da VPS** (estimativa nossa a partir dessas medidas, não valor publicado pelo Twenty): 2 vCPU, 4 GB de RAM, 40 GB de disco SSD, Linux com Docker Engine + plugin Compose, IPv4 público. Sem acesso à VPS nesta sprint: nada foi verificado nela.

**O que já existe:** imagem oficial, scripts de configuração idempotentes, `infra/jean-crm/` (compose, Caddy, `.env.example`), `scripts/jean-crm-backup.sh`. **O que falta:** VPS, domínio/DNS, conta SMTP, destino externo para os backups (ver pendências).

## 2. Ambiente limpo (Gate 1)

Validado em ambiente **isolado e descartável** (PostgreSQL e Redis novos em portas próprias, servidor desta mesma árvore na porta 3200, banco de dev **não** usado e **não** copiado).

### O que o Twenty instala sozinho

Ao ativar o workspace o Twenty cria dados de exemplo, sem opção de desligar (está no código do núcleo, `prefillCreatedWorkspaceRecords`, e não será alterado):

- 5 empresas (Airbnb, Anthropic, Stripe, Figma, Notion), 5 pessoas e 6 oportunidades, todas com autor "System";
- 1 dashboard "My First Dashboard";
- 2 workflows **ativos**: "Quick Lead" e "Create company when adding a new person".

Não vêm os ~1.200 contatos nem os mocks `[DEMO]`: esses são do ambiente de desenvolvimento (seeder / `jean-crm-demo.mjs`).

**Como tratar com segurança:** não existe como evitar a criação. Depois da configuração, o operador remove só esses registros pela interface (conferindo nome e autor "System") e decide se mantém ou desativa os dois workflows (o segundo cria empresa automaticamente ao cadastrar uma pessoa). Nunca apagar por consulta ampla. **Decisão do operador antes de entregar ao Jean.**

### Reprodução da configuração Jean (executada)

No workspace limpo, `jean-crm-setup.mjs`, `jean-crm-dashboard.mjs` e `jean-crm-tasks-kanban.mjs` foram executados nesta ordem e **reproduziram tudo na primeira passada**; a segunda passada não alterou nada (todas as mensagens "já configurado/já existe", 0 criados, 0 removidos, 0 reordenados).

| Item | Resultado |
|---|---|
| Nome Jean CRM | ok |
| Campo Interesse + pipeline de 6 etapas | ok (as 6 oportunidades de exemplo migraram de etapa) |
| Views Imóveis e Veículos | ok |
| Menu | Visão Geral, People, Companies, Opportunities, Tasks, Notes |
| Dashboard Visão Geral (6 widgets) | ok |
| Kanban de Tarefas | ok |

Observação: num workspace limpo o Twenty já traz uma view Kanban nativa **"By Status"** em Tasks (e "Assigned to Me"); o "Kanban de Tarefas" convive com ela (rótulos já em português). Não é erro; o operador pode ocultar uma das duas.

**Nunca rodar `jean-crm-demo.mjs` em produção. Também não rodar `jean-crm-smoke.mjs` (cria e apaga registros).**

## 3. Instalação (a executar no GO)

Pré-requisitos: VPS com Docker, domínio com registro DNS `A` apontando para o IP da VPS (DNS precisa propagar antes, porque o Caddy obtém o certificado por HTTP-01 nas portas 80/443), firewall liberando só 22, 80 e 443.

```bash
git clone <repositório> && cd <repositório> && git checkout jean/v2.9.0   # ou o commit aprovado
cd infra/jean-crm
cp .env.example .env && chmod 600 .env
# preencher .env: JEAN_DOMAIN, PG_PASSWORD (openssl rand -hex 24), ENCRYPTION_KEY (openssl rand -base64 32), SMTP
docker compose config >/dev/null        # valida o .env (variável faltando = erro)
docker compose up -d
docker compose ps                        # server healthy
curl -fsS https://<domínio>/healthz
```

No primeiro `up` o servidor cria o schema e roda as migrações sozinho (banco vazio); o worker sobe depois.

### Primeiro usuário e acesso (Gate 3)

Medido no ambiente isolado: **o primeiro cadastro cria o workspace e vira o dono**; depois disso novos cadastros são recusados ("New workspace setup is disabled") e um estranho não entra sem convite. Portanto:

1. Logo depois do `up`, **o próprio Jean (ou o William, com o e-mail real do Jean)** abre `https://<domínio>` e se cadastra, antes de divulgar a URL. Janela de risco: entre o `up` e esse cadastro, quem acessar primeiro vira dono.
2. Conferir: `docker compose exec db psql -U postgres -d default -tAc "select count(*) from core.workspace"` = 1 e o e-mail do dono é o esperado (`select email from core."user"`).
3. Demais usuários (William, equipe): convite pelo próprio CRM (precisa de SMTP).
4. Não criar usuários fictícios e **não** usar o usuário de seed do Twenty (`tim@apple.dev`); o seed nunca é carregado em produção.
5. Aplicar a configuração Jean a partir de uma máquina com Node 24, **sem gravar a senha em arquivo**:
   ```bash
   export TWENTY_API_URL=https://<domínio> TWENTY_ORIGIN=https://<domínio>
   read -rs JEAN_CRM_PASSWORD && export JEAN_CRM_PASSWORD   # digite a senha
   export JEAN_CRM_EMAIL=<e-mail do dono>
   node scripts/jean-crm-setup.mjs && node scripts/jean-crm-dashboard.mjs && node scripts/jean-crm-tasks-kanban.mjs
   unset JEAN_CRM_PASSWORD
   ```
   (Alternativa: `TWENTY_API_KEY`.) Rodar de novo é seguro: deve responder só "já configurado".
6. Tratar os dados de exemplo (seção 2).

A tela inicial pós-login mantém a limitação já documentada (`docs/JEAN_DASHBOARD.md`); a Visão Geral é o primeiro item do menu.

### DNS

| Registro | Valor |
|---|---|
| `A` `crm.<domínio>` | IP público da VPS |
| `AAAA` | só se a VPS tiver IPv6 funcionando |
| SPF/DKIM do domínio de e-mail | conforme o provedor SMTP escolhido (sem isso convites caem em spam) |

## 4. Segurança (Gate 2)

| Requisito | Como está atendido |
|---|---|
| HTTPS obrigatório | Caddy com certificado automático e redirecionamento de HTTP para HTTPS. |
| Usuários reais | E-mail e senha (padrão do Twenty); acesso por convite depois do dono. Sem usuários de seed. |
| Credenciais exclusivas | Senha do banco e `ENCRYPTION_KEY` gerados no servidor, diferentes de qualquer valor de dev. |
| Segredos fora do Git | `infra/jean-crm/.env` (chmod 600). Só `.env.example` (sem valores) é versionado. Perder `ENCRYPTION_KEY` torna dados cifrados irrecuperáveis: guardá-la também fora da VPS (cofre de senhas). |
| PostgreSQL/Redis sem exposição | Não têm `ports:` no compose (verificado com `docker compose config`: só 80 e 443). Atenção: o Docker ignora regras do `ufw` para portas **publicadas**, por isso nunca adicionar `ports:` a `db`/`redis`. |
| Telemetria | `TELEMETRY_ENABLED=false`. |
| Logs e saúde | `docker compose logs -f server worker`; `GET /healthz`; healthchecks do compose (`docker compose ps`). `restart: always`. |
| LGPD (mínimo) | Dados tratados: nome, e-mail, telefone e anotações de leads. Acesso só de usuários convidados; tráfego cifrado; telemetria desligada; sem envio a terceiros além do provedor SMTP (operador). Exclusão a pedido do titular: apagar o registro no CRM (backups expiram em 14 dias). Aviso de privacidade e base legal ficam para o site/jurídico (Sprint 03). |

## 5. Backup e restauração

`scripts/jean-crm-backup.sh` (no servidor) gera `db-<data>.dump` (pg_dump formato custom, validado com `pg_restore --list` antes de valer) e `files-<data>.tar.gz` (volume de arquivos) em `/var/backups/jean-crm`, permissão 600, mantendo 14 dias.

Agendamento (cron do root): `17 3 * * * /caminho/do/repo/scripts/jean-crm-backup.sh >>/var/log/jean-crm-backup.log 2>&1`

**Falta definir o destino externo** (outro servidor/bucket): backup só na mesma VPS não protege contra perda da VPS. Se o destino não for cifrado em repouso, cifrar antes de enviar.

### Restauração

```bash
cd infra/jean-crm
docker compose stop server worker
docker compose exec -T db psql -U postgres -c 'drop database "default"' -c 'create database "default"'   # aspas obrigatórias (default é palavra reservada)
docker compose exec -T db pg_restore -U postgres -d default --no-owner <db-AAAAMMDD-HHMMSS.dump
docker compose exec -T server sh -c 'rm -rf /app/packages/twenty-server/.local-storage/* ' && \
  docker compose exec -T server tar xzf - -C /app/packages/twenty-server <files-AAAAMMDD-HHMMSS.tar.gz
docker compose start server worker
```

(`drop database "default"` exige que ninguém esteja conectado: o `stop` acima cuida disso.)

**Teste executado** no ambiente isolado: `pg_dump -Fc` do banco de um workspace configurado + `pg_restore` em um banco novo. Depois, o banco `default` foi apagado e recriado com os mesmos comandos acima, o servidor subiu sobre ele e os três scripts responderam "já configurado". Resultado idêntico ao original: 1 workspace, 1 usuário, 6 oportunidades, 44 views, 6 itens de menu, 386 campos e mesmo checksum da lista de views. **Ainda não testado:** o script de backup em si (depende do stack Docker real) e a restauração dos arquivos; fazer ambos na homologação/primeiro dia antes do GO.

## 6. Atualização e rollback

Versão fixada em `TWENTY_TAG`. Atualizar só para a versão seguinte do Twenty, depois de testar em homologação.

```bash
./scripts/jean-crm-backup.sh                       # sempre antes
cd infra/jean-crm && sed -i 's/^TWENTY_TAG=.*/TWENTY_TAG=<nova>/' .env
docker compose pull && docker compose up -d        # o servidor migra o banco ao subir
curl -fsS https://<domínio>/healthz && docker compose logs --tail=100 server
```

**Rollback:** as migrações do Twenty não são reversíveis automaticamente. Voltar = restaurar o backup feito antes da atualização (seção 5) **e** voltar `TWENTY_TAG` para a versão anterior, nessa ordem. Por isso o backup antes da atualização é obrigatório.

## 7. Pendências do ambiente de desenvolvimento (Gate 4)

Nada abaixo foi alterado nesta sprint.

- **"Carro Seminovos"** (`18fb195d-366b-4c34-a78b-010577fd486c`) é uma oportunidade criada **manualmente** em 2026-11-23 pelo usuário de dev e **não consta do manifesto** da demo.
- Ela está vinculada à empresa demonstrativa `[DEMO] Jean Veículos`.
- Enquanto esse vínculo existir, `jean-crm-demo.mjs --clean` **não remove nada** (a regra "nenhuma oportunidade de fora do manifesto ligada às empresas da demo" bloqueia a limpeza).
- Remover ou desvincular exige **decisão explícita do operador**.
- Esse registro é só do dev: a produção começa em banco novo e não herda nada disso.

## 8. Checklist de implantação (GO)

Antes do GO (todos precisam estar marcados):

- [ ] VPS contratada, Docker instalado, firewall 22/80/443, acesso por chave SSH, login root por senha desligado.
- [ ] Domínio e DNS `A` propagados (`dig +short crm.<domínio>`).
- [ ] Conta SMTP e SPF/DKIM configurados.
- [ ] Destino externo de backup definido e testado.
- [ ] `ENCRYPTION_KEY` e senha do banco guardadas em cofre fora da VPS.
- [ ] E-mail real do Jean (dono) confirmado.
- [ ] Decisão sobre dados de exemplo e workflows do Twenty.
- [ ] Imagem `twentycrm/twenty:v2.9.0` baixada e `docker compose up` testado em homologação (**não feito nesta sprint**, ver Bloqueadores).

Implantação: seção 3. Depois: scripts de configuração; limpeza dos exemplos; backup manual + restauração testada em banco temporário; `jean-crm-*.mjs` repetidos devolvendo "já configurado"; conferir `docker compose ps` e `curl https://<domínio>/healthz`.

Rollback da implantação inicial: `docker compose down -v` (apaga os volumes; só serve enquanto não há dados reais).

## 9. Armadilha descoberta

O datasource do Twenty carrega o `.env` do diretório atual com `override: true`: ao rodar comandos `dist/` a partir de `packages/twenty-server`, **o `.env` de dev vence as variáveis de ambiente exportadas**. Para isolar um teste, rode de outro diretório (com `.env` próprio e links para `dist`, `node_modules` e `package.json`) e confirme o destino antes de qualquer comando. Em contêiner (produção) não há `.env`, então as variáveis do compose valem.
