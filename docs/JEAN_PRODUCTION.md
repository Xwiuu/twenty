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

## 3. Instalação e ativação controlada (a executar no GO)

Pré-requisitos: VPS com Docker, domínio com registro DNS `A` apontando para a VPS (propagado antes, porque o Caddy obtém o certificado por HTTP-01 nas portas 80/443), firewall liberando só 22, 80 e 443.

### Por que a ativação é controlada

Medido em ambiente isolado: **o primeiro cadastro cria o workspace e vira o dono**; depois disso novos cadastros são recusados ("New workspace setup is disabled") e um estranho não entra sem convite. Logo, quem se cadastrar primeiro controla o CRM. A URL **não pode** ficar aberta à espera do Jean. A defesa é de rede: o Caddy só atende os IPs listados em `JEAN_ALLOWED_IPS` (variável **obrigatória**, sem padrão: esquecer de defini-la impede o `up`).

> O Caddyfile e a restrição por IP **ainda não foram executados** (exigem baixar a imagem `caddy:2` e ter domínio/VPS). A sintaxe e a interpolação do compose foram validadas; o comportamento real (403 para IP de fora, certificado emitido mesmo assim) é item da homologação.

### Passo a passo

```bash
git clone <repositório> && cd <repositório> && git checkout jean/v2.9.0   # ou o commit aprovado
cd infra/jean-crm
cp .env.example .env && chmod 600 .env
# Preencher .env: JEAN_DOMAIN, PG_PASSWORD (openssl rand -hex 24), ENCRYPTION_KEY (openssl rand -base64 32), SMTP,
# e JEAN_ALLOWED_IPS = só o IP público do Jean e o do operador (ex.: 203.0.113.10 198.51.100.7).
docker compose config >/dev/null        # valida o .env (variável faltando = erro)
docker compose up -d
docker compose ps                        # server healthy
```

No primeiro `up` o servidor cria o schema e roda as migrações sozinho (banco vazio); o worker sobe depois.

1. **Confirmar a restrição antes de qualquer cadastro:** de uma rede **fora** da lista, `curl -sS -o /dev/null -w '%{http_code}\n' https://<domínio>/` deve dar `403`. De um IP da lista, a tela de cadastro abre. Se de fora não der 403: `docker compose stop caddy` e corrigir antes de seguir.
2. **Criar o primeiro usuário:** o próprio Jean (com o operador em chamada de vídeo), pelo IP autorizado, abre `https://<domínio>` e se cadastra com o **e-mail real** combinado antes. Nenhuma conta fictícia, nenhum usuário de seed (`tim@apple.dev`).
3. **Confirmar identidade e workspace** (no servidor):
   ```bash
   docker compose exec -T db psql -U postgres -d default -tAc 'select count(*) from core.workspace'   # deve ser 1
   docker compose exec -T db psql -U postgres -d default -tAc 'select count(*) from core."user"'      # deve ser 1
   docker compose exec -T db psql -U postgres -d default -tAc 'select email from core."user"'          # deve ser o e-mail combinado
   ```
   Além disso o Jean confirma por outro canal (ligação) que foi ele quem criou o cadastro e que consegue entrar.
4. **Se o cadastro NÃO for do administrador esperado** (e-mail diferente, mais de 1 usuário, ou ninguém reconhece): **interromper**: `docker compose down -v` (apaga os volumes; só vale porque ainda não há dados reais), conferir o `.env` e `JEAN_ALLOWED_IPS` e recomeçar do passo "docker compose up". Não prosseguir com o CRM no ar.
5. **Aplicar a configuração Jean** a partir de uma máquina com Node 24, sem gravar a senha em arquivo (a máquina precisa estar na lista de IPs):
   ```bash
   export TWENTY_API_URL=https://<domínio> TWENTY_ORIGIN=https://<domínio>
   read -rs JEAN_CRM_PASSWORD && export JEAN_CRM_PASSWORD   # digite a senha
   export JEAN_CRM_EMAIL=<e-mail do dono>
   node scripts/jean-crm-setup.mjs && node scripts/jean-crm-dashboard.mjs && node scripts/jean-crm-tasks-kanban.mjs
   unset JEAN_CRM_PASSWORD
   ```
   (Alternativa: `TWENTY_API_KEY`.) Rodar de novo é seguro: deve responder só "já configurado". Depois, tratar os dados de exemplo (seção 2).
6. **Só então liberar o acesso externo:** em `.env`, `JEAN_ALLOWED_IPS=0.0.0.0/0 ::/0`, depois `docker compose up -d caddy`. Conferir de fora: `curl -fsS https://<domínio>/healthz`.
7. Demais usuários (William, equipe): convite pelo CRM (precisa de SMTP).

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
| Acesso restrito na ativação | `JEAN_ALLOWED_IPS` obrigatório no Caddy (seção 3). |
| PostgreSQL/Redis sem exposição | Não têm `ports:` no compose (verificado com `docker compose config`: só 80 e 443). Atenção: o Docker ignora regras do `ufw` para portas **publicadas**, por isso nunca adicionar `ports:` a `db`/`redis`. |
| Telemetria | `TELEMETRY_ENABLED=false`. |
| Logs e saúde | `docker compose logs -f server worker`; `GET /healthz`; healthchecks do compose (`docker compose ps`). `restart: always`. |
| LGPD (mínimo) | Dados tratados: nome, e-mail, telefone e anotações de leads. Acesso só de usuários convidados; tráfego cifrado; telemetria desligada; sem envio a terceiros além do provedor SMTP (operador). Exclusão a pedido do titular: apagar o registro no CRM (backups expiram em 14 dias). Aviso de privacidade e base legal ficam para o site/jurídico (Sprint 03). |

## 5. Backup e restauração

### Backup — `scripts/jean-crm-backup.sh` (no servidor)

Gera `db-<data>.dump` (pg_dump formato custom) e `files-<data>.tar.gz` (volume de anexos) em `/var/backups/jean-crm`, permissão 600, retenção de 14 dias. Garantias:

- escreve primeiro em `*.partial`; só renomeia os **dois** para o nome final depois de verificar ambos (dump legível por `pg_restore --list`; `.tar.gz` não vazio, íntegro por `gzip -t`, legível por `tar tzf` e com `.local-storage`);
- qualquer falha apaga os parciais, sai com código ≠ 0 e **não imprime** "Backup concluído"; a retenção só roda depois do sucesso;
- os anexos são lidos por um contêiner temporário com o mesmo volume (`docker compose run --rm --no-deps`), então não dependem de o servidor estar rodando.

Agendamento (cron do root): `17 3 * * * /caminho/do/repo/scripts/jean-crm-backup.sh >>/var/log/jean-crm-backup.log 2>&1`. Verifique o log: uma linha "Backup concluído e verificado" por dia.

**Falta definir o destino externo** (outro servidor/bucket): backup só na mesma VPS não protege contra perda da VPS. Se o destino não for cifrado em repouso, cifrar antes de enviar.

### Restauração — `scripts/jean-crm-restore.sh <db-*.dump> <files-*.tar.gz> --yes`

Corrige o procedimento anterior, que tentava `docker compose exec server` com o servidor parado (não funciona). Agora:

1. **valida** os dois arquivos antes de parar qualquer coisa (se algo estiver corrompido, aborta e a aplicação continua no ar);
2. para `caddy`, `worker` e `server` (o `db` fica de pé);
3. restaura o banco em um banco **novo** (`default_restore_<data>`); só se der certo e houver workspace nele, troca os nomes: o banco atual vira `default_old_<data>` (**não é apagado**);
4. restaura os anexos com um **contêiner temporário** que monta o volume (o servidor está parado): o conteúdo atual vai para `.local-storage/.pre-restore-<data>` (**não é apagado**) e o `.tar.gz` é extraído em seguida, preservando caminhos e permissões;
5. sobe tudo com `docker compose up -d --wait` (espera os healthchecks);
6. valida: serviços saudáveis, workspaces no banco e **lista de arquivos do volume idêntica à do backup**.

Nenhum volume é removido. Depois de conferir o CRM, o operador remove manualmente o banco antigo e a pasta `.pre-restore-*` (comandos impressos no final). Enquanto existir, a pasta `.pre-restore-*` entra nos backups seguintes.

### Evidências de teste (executadas)

Os scripts reais foram executados contra um stack de teste com os **mesmos nomes de serviço e volume** (`db`, `server`, `worker`, `caddy`, `server-local-data`), usando a imagem `postgres:16` local no lugar da imagem do Twenty e **dados fictícios** (1 workspace, 3 notas, 3 arquivos: subpasta, nome com espaço, permissão 640). Nenhum dado real, nenhum banco de dev.

| Teste | Resultado |
|---|---|
| Backup normal | exit 0; `db-*.dump` e `files-*.tar.gz` gerados (600); tar com subpastas, nome com espaço e permissão 640 preservados |
| Backup com falha nos arquivos | exit ≠ 0, sem "concluído", **0 arquivos** (nem parciais) no diretório |
| Backup com banco parado | exit ≠ 0, sem "concluído", 0 arquivos |
| Restauração sem `--yes` | exit 2, nada alterado |
| Restauração com dump truncado | `ERRO: dump ilegível`, exit ≠ 0, **serviços continuam rodando**, dados inalterados |
| Restauração com `.tar.gz` corrompido | `ERRO: .tar.gz corrompido`, exit ≠ 0, serviços continuam rodando |
| Restauração real (após apagar o workspace, apagar uma nota, corromper um arquivo, apagar outro e criar um novo) | exit 0; workspace e notas de volta; arquivos de volta com o conteúdo original e permissão 640; o arquivo criado depois do backup ficou em `.pre-restore-*`; banco anterior preservado como `default_old_*`; 4 serviços rodando |

### O que NÃO foi executado

- **Imagem oficial do Twenty**: não foi baixada (precisa de autorização). Fica sem verificação que o `tar`/`sh` do contêiner do Twenty se comportam como no teste (a imagem é baseada em Node/Debian, que os possuem), que o usuário do contêiner consegue gravar no volume e que o healthcheck real (`curl /healthz`) passa pelo `--wait`.
- **Restauração sobre dados reais do Twenty** (o teste usou tabelas fictícias; o `pg_restore` de um banco real do Twenty foi validado separadamente na Sprint 02.7, com checksum idêntico).
- **Caddy** (ver seção 3) e **destino externo** de backup.

Esses itens são pré-requisitos da homologação com o stack real, antes do GO.

## 6. Atualização e rollback

Versão fixada em `TWENTY_TAG`. Atualizar só para a versão seguinte do Twenty, depois de testar em homologação.

```bash
./scripts/jean-crm-backup.sh                       # sempre antes
cd infra/jean-crm && sed -i 's/^TWENTY_TAG=.*/TWENTY_TAG=<nova>/' .env
docker compose pull && docker compose up -d        # o servidor migra o banco ao subir
curl -fsS https://<domínio>/healthz && docker compose logs --tail=100 server
```

**Rollback:** as migrações do Twenty não são reversíveis automaticamente. Voltar = (1) editar `TWENTY_TAG` no `.env` para a versão anterior e (2) rodar `scripts/jean-crm-restore.sh` com o backup feito antes da atualização (seção 5); o script sobe os serviços com a tag do `.env`, por isso a tag vem primeiro. Por isso o backup antes da atualização é obrigatório.

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
- [ ] Homologação com o stack real: imagem `twentycrm/twenty:v2.9.0` e `caddy:2` baixadas; `docker compose up`; restrição por IP do Caddy (403 de fora); backup e restauração (banco e anexos) com a imagem real (**não feito**).
- [ ] IP público do Jean e do operador conhecidos (para `JEAN_ALLOWED_IPS`).

Implantação e ativação controlada: seção 3. Depois: scripts de configuração; limpeza dos exemplos; backup manual e teste de restauração (seção 5) antes de liberar para o Jean usar; `jean-crm-*.mjs` repetidos devolvendo "já configurado"; conferir `docker compose ps` e `curl https://<domínio>/healthz`.

Rollback da implantação inicial / ativação abortada: `docker compose down -v` (apaga os volumes; só vale enquanto não há dados reais; nunca como parte de uma restauração).

## 9. Armadilha descoberta

O datasource do Twenty carrega o `.env` do diretório atual com `override: true`: ao rodar comandos `dist/` a partir de `packages/twenty-server`, **o `.env` de dev vence as variáveis de ambiente exportadas**. Para isolar um teste, rode de outro diretório (com `.env` próprio e links para `dist`, `node_modules` e `package.json`) e confirme o destino antes de qualquer comando. Em contêiner (produção) não há `.env`, então as variáveis do compose valem.
