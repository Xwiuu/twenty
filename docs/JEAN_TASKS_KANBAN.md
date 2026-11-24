# Jean CRM — Kanban de Tarefas (Sprint 02.6)

View **Kanban nativa** do Twenty `v2.9.0` sobre o objeto Task, agrupada por `status`. Sem código de frontend, sem objetos ou campos novos.

| Coluna | Valor (`status`) |
|---|---|
| A fazer | `TODO` |
| Em andamento | `IN_PROGRESS` |
| Concluídas | `DONE` |

A coluna **No Value** é nativa do Twenty para tarefas sem status; fica vazia. O cartão mostra título, prazo e responsável. A view de lista **All Tasks** é preservada; o Kanban é uma view a mais.

## Reproduzir em workspace limpo

```bash
JEAN_CRM_EMAIL=<email> JEAN_CRM_PASSWORD=<senha> node scripts/jean-crm-tasks-kanban.mjs
# ou TWENTY_API_KEY=<chave>
```

O script:

1. Troca só os **rótulos** de `status` para A fazer / Em andamento / Concluídas (valores, ids, cores e posições não mudam). Aborta, sem alterar nada, se as opções não forem exatamente `TODO`, `IN_PROGRESS`, `DONE`.
2. Cria a view "Kanban de Tarefas" (KANBAN, agrupada por `status`, contagem por coluna). As colunas são criadas pelo próprio Twenty.

Idempotente: se a view já existe como esperado, não faz nada. Aborta sem alterar se houver duas views com o nome, ou se a existente não for KANBAN, não agrupar por status ou tiver colunas diferentes. Nenhuma view é sobrescrita.

O dashboard (`docs/JEAN_DASHBOARD.md`) filtra por **valor** de status, então não é afetado pelos rótulos.

Testes: `node --test scripts/jean-crm-*.test.mjs`.

## Observações

- Arrastar um cartão entre colunas altera `status` e persiste; o dashboard reflete a mudança.
- Uma sincronização futura do Twenty com a definição padrão de `status` pode devolver os rótulos em inglês; rode o script de novo.
- Validado só na `v2.9.0`.
