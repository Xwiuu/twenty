# Jean CRM — branding e navegação (Sprint 02)

Base: Twenty `v2.9.0`, branch `jean/v2.9.0`. Tudo é configuração via API nativa de metadata; **nenhum código-fonte do Twenty foi alterado.**

## O que foi personalizado

| Item | Como |
|---|---|
| Nome do workspace | `updateWorkspace`: **Jean CRM** (aparece no topo da barra lateral) |
| Navegação | Só **Pessoas, Oportunidades, Tarefas, Notas**, nessa ordem. Os demais itens (Empresas, Dashboards, Workflows e objetos de demonstração) saem do menu do workspace. |
| Visualizações de Oportunidades | **All Opportunities** (tabela, agora com coluna Interesse), **By Stage** (Kanban com as 6 etapas), **Imóveis** e **Veículos** (tabelas filtradas por Interesse) |

Os objetos e os dados continuam existindo; só o item de menu é removido. Itens pessoais de cada usuário não são tocados. Configurações (Settings) não fazem parte desse menu e continuam acessíveis.

## Reproduzir

O mesmo script da Sprint 01, idempotente (veja `docs/JEAN_CRM.md`):

```bash
JEAN_CRM_EMAIL=<email> JEAN_CRM_PASSWORD=<senha> node scripts/jean-crm-setup.mjs
```

Proteção: antes de remover qualquer item, o script exige Pessoas, Oportunidades, Tarefas e Notas exatamente uma vez, no nível do workspace, como item de objeto e fora de pasta. Se algum faltar, estiver duplicado ou só existir dentro de pasta, aborta sem alterar o menu.

Reexecutar reaplica o contrato: o menu do workspace volta a ter só os 4 itens. Itens de menu de workspace adicionados à mão depois serão removidos na próxima execução (itens pessoais, não).

Para desfazer no ambiente de dev: restaurar o backup (`pg_restore`) ou recriar os itens pela edição da barra lateral.

## O que continua padrão do Twenty

- **Logo:** sem imagem. O workspace usa o avatar nativo com a inicial "J". Upload de logo exige arquivo de imagem (definitivo a cargo do Jean).
- **Título da aba do navegador:** "Twenty" em `packages/twenty-front/index.html`, e títulos por página definidos no código (`PageTitle`). Mudar exige alterar código-fonte, então ficou padrão.
- **Cores e tema:** padrão do Twenty. Claro/escuro é preferência de cada usuário.
- **Idioma da interface:** inglês (preferência de cada usuário). Rótulos criados por nós (etapas, Interesse, views Imóveis/Veículos) estão em português.
- Créditos e avisos de licença: intactos.

## Testes executados (v2.9.0, workspace de dev)

- `node --test scripts/jean-crm-setup.test.mjs`: 15/15 (7 da Sprint 01 + 8 de navegação, incluindo aborto e prova de zero mutações).
- Script rodado ao vivo; segunda execução sem alterações.
- API: workspace "Jean CRM"; 4 itens de navegação na ordem esperada; views Imóveis/Veículos com filtro `IS` no campo Interesse e 7 colunas.
- Regressão: smoke test da Sprint 01 passou (imóveis e veículos); 50 oportunidades, 1200 pessoas, 599 empresas, 29 objetos ativos preservados; sem erros nos logs.

## Limitações e pendências

- **Validação visual não realizada por esta automação** (extensão do Chrome desconectada). Conferir no navegador: nome no topo, menu com 4 itens, views Imóveis/Veículos mostrando só os registros do respectivo interesse (o filtro foi gravado no formato do frontend, mas a aplicação dele na tela não foi observada).
- Views filtradas são tabelas; o Kanban por etapa segue sendo "By Stage" (sem filtro por interesse).
- Aplicado só ao workspace do usuário informado.
