# Jean CRM — demonstração (Sprint 02.2)

Um único workspace Twenty (`v2.9.0`) atende as duas operações: **Jean Imóveis** e **Jean Veículos**, separadas pelo campo `Interesse` das oportunidades e compartilhando o mesmo pipeline. Sem objetos, workspaces ou bancos novos.

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

10 oportunidades fictícias, cada uma com 1 contato, 1 tarefa de acompanhamento, e 1 nota em duas delas:

| Operação | Oportunidades (etapas) |
|---|---|
| Imóveis (5) | apartamento (Novo), casa (Contatado), venda de imóvel residencial (Qualificado), terreno (Negociação), atendimento inicial (Ganho) |
| Veículos (5) | SUV (Novo), carro usado (Contatado), venda de veículo (Qualificado), troca (Negociação), veículo econômico (Perdido) |

Não há imóveis, veículos, preços, placas ou anúncios como registros.

## Como os mocks são identificados (manifesto)

Nome ou e-mail iguais **não** provam que um registro é da demo. A propriedade é definida por um **manifesto local de UUIDs**, gravado a cada criação:

- Caminho padrão: `~/.jean-crm/demo-manifest.json` (fora do Git); troque com `JEAN_DEMO_MANIFEST=<caminho>`.
- Guarda, por workspace, os UUIDs de contatos, oportunidades, tarefas e notas criados pelo script. Sem credenciais e sem dados pessoais reais.
- Os registros também têm marcas visíveis: prefixo `[DEMO] ` e e-mails `demo-01..10@example.test`. A lista está em `scripts/jean-crm-demo.mjs`. Isso ajuda a olhar, mas não autoriza exclusão.

Carga: se já existir um registro com identificador da demo que **não** esteja no manifesto, a carga aborta sem criar nada. Se a carga cair no meio, os UUIDs já criados ficam no manifesto e rodar de novo completa o resto sem duplicar.

## Mocks criados antes do manifesto (adoção)

Só se já houver mocks de uma versão anterior do script:

```bash
node scripts/jean-crm-demo.mjs --adopt            # dry-run: verifica e mostra quantos adotaria
node scripts/jean-crm-demo.mjs --adopt --confirm  # grava no manifesto
```

A adoção exige correspondência única e exatamente as relações da demo (contato, tarefa e nota ligados à oportunidade certa). Se algo divergir, aborta sem gravar. Use apenas quando você sabe que aqueles registros vieram deste script.

## Remover com segurança

```bash
node scripts/jean-crm-demo.mjs --clean            # dry-run: lista o que seria removido
node scripts/jean-crm-demo.mjs --clean --confirm  # remove
```

Antes de remover, o script verifica: manifesto do **mesmo workspace**; todos os UUIDs existentes e com o nome/e-mail esperado; relações exatamente as da demo (nenhuma tarefa/nota extra ligada às oportunidades da demo); nenhuma duplicidade. Se faltar manifesto, se algum UUID do manifesto não existir mais no CRM, ou houver qualquer outra divergência, **não remove nada** e o manifesto é preservado. (Se alguém apagou um mock à mão, rode a carga de novo para recriá-lo e depois a limpeza.) A exclusão é sempre por UUID do manifesto. Ao final, o workspace sai do manifesto.

## Conferir na interface (manual)

1. Entrar em http://localhost:3001 (login de dev do seed, veja `docs/JEAN_SETUP.md`). No topo deve aparecer **Jean CRM**.
2. Menu lateral: só **People, Opportunities, Tasks, Notes**.
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
- **Validação visual: não realizada por esta automação** (navegador indisponível). Use a lista acima.

## Pendências para produção

- Validação visual obrigatória antes de entregar ao Jean.
- Dados de demonstração do Twenty (empresas, pessoas, 50 oportunidades) ainda existem no banco de dev; em produção usar workspace novo e **não** rodar `jean-crm-demo.mjs`.
- Scripts validados só na `v2.9.0`.
