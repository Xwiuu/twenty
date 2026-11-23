# Jean CRM — demonstração (Sprint 02.2, empresas na 02.4)

Um único workspace Twenty (`v2.9.0`) atende as duas operações: **Jean Imóveis** e **Jean Veículos**, separadas pelo campo `Interesse` das oportunidades e compartilhando o mesmo pipeline. Sem objetos, workspaces ou bancos novos.

Na Sprint 02.4 cada operação ganhou uma **empresa demonstrativa** (registro nativo `Company`): `[DEMO] Jean Imóveis` e `[DEMO] Jean Veículos`. Servem só para organizar a experiência na tela; **não são pessoas jurídicas reais** nem uma estrutura multiempresa (sem CNPJ, telefone, site ou endereço). O vínculo real do negócio continua sendo o campo Interesse.

## Passo a passo

1. **Iniciar:** veja `docs/JEAN_SETUP.md` (`yarn start`; frontend em http://localhost:3001).
2. **Configurar** (campo, pipeline, nome, menu, views): `node scripts/jean-crm-setup.mjs` (detalhes em `docs/JEAN_CRM.md` e `docs/JEAN_BRANDING.md`).
3. **Carregar a demonstração:**

```bash
JEAN_CRM_EMAIL=<email> JEAN_CRM_PASSWORD=<senha> node scripts/jean-crm-demo.mjs
```

Execução sempre explícita. Idempotente: rodar de novo não duplica nada.

4. **Conferir o filtro das views pela API:** `node scripts/jean-crm-demo.mjs --verify` (mesmas variáveis de ambiente).

## O que é criado

2 empresas, e 10 oportunidades fictícias, cada uma com 1 contato, 1 tarefa de acompanhamento, e 1 nota em duas delas. Os 5 contatos e as 5 oportunidades de cada interesse ficam vinculados à empresa correspondente (Company nativa existe tanto em Pessoas quanto em Oportunidades na v2.9.0, então não foi preciso relacionamento customizado):

| Operação | Oportunidades (etapas) |
|---|---|
| Imóveis (5) | apartamento (Novo), casa (Contatado), venda de imóvel residencial (Qualificado), terreno (Negociação), atendimento inicial (Ganho) |
| Veículos (5) | SUV (Novo), carro usado (Contatado), venda de veículo (Qualificado), troca (Negociação), veículo econômico (Perdido) |

Não há imóveis, veículos, preços, placas ou anúncios como registros.

## Como os mocks são identificados (manifesto)

Nome ou e-mail iguais **não** provam que um registro é da demo. A propriedade é definida por um **manifesto local de UUIDs**, gravado a cada criação:

- Caminho padrão: `~/.jean-crm/demo-manifest.json` (fora do Git); troque com `JEAN_DEMO_MANIFEST=<caminho>`.
- Guarda, por workspace, os UUIDs de empresas, contatos, oportunidades, tarefas e notas criados pelo script. Versão 2 (a versão 1, da Sprint 02.3, não tinha `companies`; é migrada ao ler, só acrescentando `companies: {}`, e uma versão desconhecida aborta sem alterar nada). Sem credenciais e sem dados pessoais reais.
- Os registros também têm marcas visíveis: prefixo `[DEMO] ` e e-mails `demo-01..10@example.test`. A lista está em `scripts/jean-crm-demo.mjs`. Isso ajuda a olhar, mas não autoriza exclusão.

Carga: se já existir um registro (inclusive uma empresa com o mesmo nome) com identificador da demo que **não** esteja no manifesto, a carga aborta sem criar nada. Empresa nunca é reivindicada por nome. Ao vincular empresa a registros da demo já existentes (primeira vez, manifesto v1), o script verifica antes o conjunto inteiro e aborta se algo divergir; também aborta se um contato/oportunidade da demo já estiver ligado a uma empresa que não é da demo. Se a carga cair no meio, os UUIDs já criados ficam no manifesto e rodar de novo completa o resto sem duplicar.

## Mocks criados antes do manifesto (adoção)

Só se já houver mocks de uma versão anterior do script:

```bash
node scripts/jean-crm-demo.mjs --adopt            # dry-run: verifica e mostra quantos adotaria
node scripts/jean-crm-demo.mjs --adopt --confirm  # grava no manifesto
```

A adoção não adota empresas (só contatos, oportunidades, tarefas e notas). Exige correspondência única e exatamente as relações da demo (contato, tarefa e nota ligados à oportunidade certa). Se algo divergir, aborta sem gravar. Use apenas quando você sabe que aqueles registros vieram deste script.

## Remover com segurança

```bash
node scripts/jean-crm-demo.mjs --clean            # dry-run: lista o que seria removido
node scripts/jean-crm-demo.mjs --clean --confirm  # remove
```

Antes de remover, o script verifica: manifesto do **mesmo workspace**; todos os UUIDs existentes e com o nome/e-mail esperado; relações exatamente as da demo (nenhuma tarefa/nota extra ligada às oportunidades da demo; cada contato/oportunidade na empresa certa; nenhum contato ou oportunidade de fora ligado às duas empresas); nenhuma duplicidade. Se faltar manifesto, se algum UUID do manifesto não existir mais no CRM, ou houver qualquer outra divergência, **não remove nada** e o manifesto é preservado. (Se alguém apagou um mock à mão, rode a carga de novo para recriá-lo e depois a limpeza.) A exclusão é sempre por UUID do manifesto (inclui as duas empresas do manifesto; empresas preexistentes não são tocadas). Ao final, o workspace sai do manifesto.

## Conferir na interface (manual)

1. Entrar em http://localhost:3001 (login de dev do seed, veja `docs/JEAN_SETUP.md`). No topo deve aparecer **Jean CRM**.
2. Menu lateral: só **People, Companies, Opportunities, Tasks, Notes**. Em Companies, as duas `[DEMO]` (colunas Name, People, Opportunities); em People, os 10 contatos `[DEMO]` com a coluna Company preenchida (5 e 5).
3. Opportunities → view **Imóveis**: 5 registros `[DEMO]` de imóveis, nenhum de veículos. View **Veículos**: o inverso. A coluna **Interesse** aparece nas duas.
4. View **By Stage** (Kanban): as 10 demos nas colunas Novo, Contatado, Qualificado, Negociação, Ganho e Perdido (2/2/2/2/1/1).
5. Abrir uma oportunidade: contato vinculado, aba Tasks com a tarefa de acompanhamento; nas duas com nota, aba Notes.
6. Criar e editar uma oportunidade de teste e mudar a etapa arrastando o card.

## Testes executados (v2.9.0, workspace de dev)

- `node --test scripts/jean-crm-setup.test.mjs scripts/jean-crm-demo.test.mjs` (os testes de carga/adoção/limpeza usam um CRM e manifesto em memória, sem tocar no banco).
- Ao vivo: adoção dos mocks existentes, carga idempotente, limpeza bloqueada sem manifesto, limpeza confirmada voltando exatamente à contagem anterior, recarga com manifesto.
- `--verify`: Imóveis e Veículos mostram só o próprio interesse (5 de demo cada).
- Dados preexistentes comparados com backup anterior (checksum por tabela): idênticos.
- Smoke test da Sprint 01 (imóveis e veículos): passou.
- **Validação visual (Sprint 02.4, Chrome headless no ambiente local, login de dev do seed):** vistos na tela: título "Bem-vindo, Jean CRM." e nome no topo; menu de 5 itens na ordem; Companies com as duas `[DEMO]` e colunas Name/People/Opportunities (domínio e endereço vazios); People com Nome/E-mail/Telefone/Company e os 10 contatos na empresa certa; Opportunities com Nome/Interesse/Etapa/Contato/Empresa; seletor com All Opportunities, By Stage, Imóveis e Veículos; view Imóveis com 5 linhas e chip "Interesse: Imóveis"; Veículos com 5 e "Interesse: Veículos"; Kanban com as 6 etapas e os mocks 2/2/2/2/1/1 no topo de cada coluna. **Não vistos:** abas Tasks/Notes dentro de uma oportunidade, arrastar card no Kanban e criar/editar registro (use o roteiro acima).

## Pendências para produção

- Conferência manual do que a validação headless não cobriu (lista acima) antes de entregar ao Jean.
- Dados de demonstração do Twenty (empresas, pessoas, 50 oportunidades) ainda existem no banco de dev; em produção usar workspace novo e **não** rodar `jean-crm-demo.mjs`.
- Scripts validados só na `v2.9.0`.
