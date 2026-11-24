# Jean CRM — dashboard "Visão Geral" (Sprint 02.5)

Dashboard **nativo** do Twenty `v2.9.0` (objeto Dashboard + widgets de gráfico). Sem código de frontend, sem migration, sem objetos novos.

## Widgets

Todos usam `COUNT` sobre registros existentes (nada fixo no código, nenhum valor de venda, faturamento ou comissão).

| Widget | Fonte / filtro |
|---|---|
| Total de oportunidades | Opportunities, sem filtro |
| Oportunidades de Imóveis | `interesse = IMOVEIS` |
| Oportunidades de Veículos | `interesse = VEICULOS` |
| Oportunidades por etapa | Gráfico de barras agrupado por `stage` (6 etapas) |
| Tarefas pendentes | Tasks com `status` TODO ou IN_PROGRESS |
| Tarefas concluídas | Tasks com `status` DONE |

**Demo x real:** os widgets contam **todos** os registros do workspace; não há filtro por demonstração (o manifesto de UUIDs da demo não é consultável pelo dashboard). Em um workspace limpo de produção os números são só dados reais. No ambiente de dev eles incluem os mocks `[DEMO]` e os dados de exemplo do Twenty (oportunidades sem `Interesse`, por isso Imóveis + Veículos < Total).

## Reproduzir em workspace limpo

Pré-requisito: `scripts/jean-crm-setup.mjs` já executado (campo `Interesse`, pipeline).

```bash
JEAN_CRM_EMAIL=<email> JEAN_CRM_PASSWORD=<senha> node scripts/jean-crm-dashboard.mjs
# ou TWENTY_API_KEY=<chave>
```

Idempotente: cria o dashboard (6 widgets) e o item **Visão Geral** em primeiro lugar no menu. Se já existe, não recria. Aborta sem alterar se houver dashboard com o mesmo título e widgets diferentes (ou duplicado). O item de menu só é criado depois do dashboard completo.

`scripts/jean-crm-setup.mjs` passou a **preservar** esse item (e mantê-lo em primeiro) ao simplificar o menu; sem o dashboard, o comportamento anterior é idêntico.

Testes: `node --test scripts/jean-crm-*.test.mjs`.

## Tela inicial pós-login — limitação

O Twenty v2.9.0 **não tem configuração** de tela inicial. Após o login abre o último objeto visitado ou, sem histórico, o primeiro objeto em ordem alfabética (hoje Companies) — `useDefaultHomePagePath`. Dashboards não participam dessa regra. Mudar isso exige alterar o hook no núcleo do frontend, o que foi considerado invasivo; por isso a Visão Geral é o **primeiro item do menu**.

Itens de menu `PAGE_LAYOUT` só abrem páginas standalone (dashboards dão "não encontrado"), por isso o item é do tipo `RECORD`.

## Outras notas

- O CRM depende de a porta 3001 estar livre para o frontend do Twenty; nesta máquina outro app a usava (validação feita com o frontend em `REACT_APP_PORT=3011`).
- Validado só na `v2.9.0`.
