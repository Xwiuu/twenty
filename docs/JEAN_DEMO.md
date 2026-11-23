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

## Como identificar os mocks

- Oportunidades, tarefas, notas e o nome dos contatos começam com `[DEMO] `.
- E-mails: `demo-01@example.test` a `demo-10@example.test` (domínio reservado, nunca entrega).
- A lista exata está em `scripts/jean-crm-demo.mjs` e é a única referência usada para idempotência e limpeza.

## Remover com segurança

```bash
JEAN_CRM_EMAIL=<email> JEAN_CRM_PASSWORD=<senha> node scripts/jean-crm-demo.mjs --clean
```

Remove apenas registros cujo nome/título/e-mail seja **exatamente** um da lista acima (nunca por padrão genérico, etapa ou interesse). Outros registros do workspace não são tocados.

## Conferir na interface (manual)

1. Entrar em http://localhost:3001 (login de dev do seed, veja `docs/JEAN_SETUP.md`). No topo deve aparecer **Jean CRM**.
2. Menu lateral: só **People, Opportunities, Tasks, Notes**.
3. Opportunities → view **Imóveis**: 5 registros `[DEMO]` de imóveis, nenhum de veículos. View **Veículos**: o inverso. A coluna **Interesse** aparece nas duas.
4. View **By Stage** (Kanban): as 10 demos nas colunas Novo, Contatado, Qualificado, Negociação, Ganho e Perdido (2/2/2/2/1/1).
5. Abrir uma oportunidade: contato vinculado, aba Tasks com a tarefa de acompanhamento; nas duas com nota, aba Notes.
6. Criar e editar uma oportunidade de teste e mudar a etapa arrastando o card.

## Testes executados (v2.9.0, workspace de dev)

- `node --test scripts/jean-crm-setup.test.mjs scripts/jean-crm-demo.test.mjs`: 19/19.
- Carga, 2ª carga sem duplicar e `--clean` voltando exatamente à contagem anterior; carga refeita.
- `--verify`: Imóveis e Veículos mostram só o próprio interesse (5 de demo cada).
- Dados preexistentes comparados com backup anterior (checksum por tabela): idênticos.
- Smoke test da Sprint 01 (imóveis e veículos): passou.
- **Validação visual: não realizada por esta automação** (navegador indisponível). Use a lista acima.

## Pendências para produção

- Validação visual obrigatória antes de entregar ao Jean.
- Dados de demonstração do Twenty (empresas, pessoas, 50 oportunidades) ainda existem no banco de dev; em produção usar workspace novo e **não** rodar `jean-crm-demo.mjs`.
- Scripts validados só na `v2.9.0`.
