// Cria o dashboard nativo "Visão Geral — Jean CRM" pela API do Twenty. Idempotente.
// Uso: veja docs/JEAN_DASHBOARD.md. Credenciais só por variáveis de ambiente.
import { pathToFileURL } from 'node:url';
import { DASHBOARD_TITLE, getToken, request } from './jean-crm-setup.mjs';

export { DASHBOARD_TITLE };
const TAB_TITLE = 'Visão Geral';

const countOf = (fieldId, filter, extra = {}) => ({
  configurationType: 'AGGREGATE_CHART',
  aggregateFieldMetadataId: fieldId,
  aggregateOperation: 'COUNT',
  displayDataLabel: false,
  timezone: 'UTC',
  ...(filter ? { filter } : {}),
  ...extra,
});

const selectFilter = (fieldMetadataId, label, values) => ({
  recordFilters: [
    {
      type: 'SELECT',
      label,
      value: JSON.stringify(values),
      displayValue: values.join(', '),
      operand: 'IS',
      fieldMetadataId,
    },
  ],
  recordFilterGroups: [],
});

// Os números vêm sempre de COUNT sobre os registros do CRM; nada é fixo no código.
export const buildWidgets = ({ opportunity, task }) => {
  const kpi = (title, object, filter, row, column) => ({
    title,
    type: 'GRAPH',
    objectMetadataId: object.objectId,
    gridPosition: { row, column, rowSpan: 3, columnSpan: 4 },
    configuration: countOf(object.fields.id, filter),
  });
  const interest = (value) =>
    selectFilter(opportunity.fields.interesse, 'Interesse', [value]);
  const status = (values) => selectFilter(task.fields.status, 'Status', values);
  return [
    kpi('Total de oportunidades', opportunity, undefined, 0, 0),
    kpi('Oportunidades de Imóveis', opportunity, interest('IMOVEIS'), 0, 4),
    kpi('Oportunidades de Veículos', opportunity, interest('VEICULOS'), 0, 8),
    {
      title: 'Oportunidades por etapa',
      type: 'GRAPH',
      objectMetadataId: opportunity.objectId,
      gridPosition: { row: 3, column: 0, rowSpan: 6, columnSpan: 8 },
      configuration: {
        configurationType: 'BAR_CHART',
        aggregateFieldMetadataId: opportunity.fields.id,
        aggregateOperation: 'COUNT',
        primaryAxisGroupByFieldMetadataId: opportunity.fields.stage,
        primaryAxisOrderBy: 'FIELD_POSITION_ASC',
        axisNameDisplay: 'NONE',
        displayDataLabel: true,
        displayLegend: false,
        layout: 'VERTICAL',
        timezone: 'UTC',
      },
    },
    kpi('Tarefas pendentes', task, status(['TODO', 'IN_PROGRESS']), 3, 8),
    kpi('Tarefas concluídas', task, status(['DONE']), 6, 8),
  ];
};

// Decide o que fazer com o estado atual, sem tocar na API.
export const planDashboard = (existing, wantedTitles) => {
  if (existing.length === 0) return { action: 'create' };
  if (existing.length > 1) {
    return {
      action: 'abort',
      reason: `Há ${existing.length} dashboards chamados "${DASHBOARD_TITLE}". Abortando sem alterar.`,
    };
  }
  const have = existing[0].widgetTitles;
  const same =
    have.length === wantedTitles.length &&
    wantedTitles.every((title) => have.includes(title));
  return same
    ? { action: 'skip', dashboard: existing[0] }
    : {
        action: 'abort',
        reason: `O dashboard "${DASHBOARD_TITLE}" já existe com widgets diferentes (${have.join(', ') || 'nenhum'}). Abortando para não sobrescrever.`,
      };
};

// Item de menu (RECORD) do dashboard em primeiro lugar; os itens do workspace descem uma posição.
// Não usa PAGE_LAYOUT: no Twenty v2.9.0 esse tipo só abre páginas standalone.
export const planDashboardNavigation = (items, dashboardId) => {
  const workspaceItems = items
    .filter((item) => !item.userWorkspaceId)
    .sort((a, b) => a.position - b.position);
  const existing = workspaceItems.find(
    (item) => item.type === 'RECORD' && item.targetRecordId === dashboardId,
  );
  const others = workspaceItems.filter((item) => item !== existing);
  const ordered = existing ? [existing, ...others] : [null, ...others];
  const moves = ordered
    .map((item, position) => ({ item, position }))
    .filter(({ item, position }) => item && item.position !== position)
    .map(({ item, position }) => ({ id: item.id, position }));
  return { create: existing ? null : { position: 0 }, moves };
};

const loadFieldIds = async (token) => {
  const data = await request(
    '/metadata',
    `{ objects(paging:{first:200}) { edges { node { id nameSingular } } } }`,
    {},
    token,
  );
  const result = {};
  for (const { node } of data.objects.edges) {
    if (node.nameSingular === 'dashboard') result.dashboardObjectId = node.id;
    if (!['opportunity', 'task'].includes(node.nameSingular)) continue;
    const fields = await request(
      '/metadata',
      `query($id:UUID!){ fields(paging:{first:200}, filter:{objectMetadataId:{eq:$id}}) { edges { node { id name } } } }`,
      { id: node.id },
      token,
    );
    const byName = Object.fromEntries(
      fields.fields.edges.map(({ node: field }) => [field.name, field.id]),
    );
    result[node.nameSingular] = { objectId: node.id, fields: byName };
  }
  for (const [object, names] of [
    ['opportunity', ['id', 'interesse', 'stage']],
    ['task', ['id', 'status']],
  ]) {
    for (const name of names) {
      if (!result[object]?.fields[name]) {
        throw new Error(
          `Campo ${object}.${name} não encontrado. Rode scripts/jean-crm-setup.mjs antes.`,
        );
      }
    }
  }
  return result;
};

const findDashboards = async (token) => {
  const data = await request(
    '/graphql',
    `query($title:String!){ dashboards(filter:{title:{eq:$title}}) { edges { node { id title pageLayoutId } } } }`,
    { title: DASHBOARD_TITLE },
    token,
  );
  const result = [];
  for (const { node } of data.dashboards.edges) {
    const layout = await request(
      '/metadata',
      `query($id:String!){ getPageLayout(id:$id){ tabs { id title widgets { id title } } } }`,
      { id: node.pageLayoutId },
      token,
    );
    result.push({
      ...node,
      tabs: layout.getPageLayout.tabs,
      widgetTitles: layout.getPageLayout.tabs.flatMap((tab) =>
        tab.widgets.map((widget) => widget.title),
      ),
    });
  }
  return result;
};

const createDashboard = async (token, widgets) => {
  const created = await request(
    '/graphql',
    `mutation($title:String!){ createDashboard(data:{title:$title}){ id pageLayoutId } }`,
    { title: DASHBOARD_TITLE },
    token,
  );
  const { id, pageLayoutId } = created.createDashboard;
  const layout = await request(
    '/metadata',
    `query($id:String!){ getPageLayout(id:$id){ tabs { id } } }`,
    { id: pageLayoutId },
    token,
  );
  const [tab] = layout.getPageLayout.tabs;
  await request(
    '/metadata',
    `mutation($id:String!,$input:UpdatePageLayoutTabInput!){ updatePageLayoutTab(id:$id,input:$input){ id } }`,
    { id: tab.id, input: { title: TAB_TITLE } },
    token,
  );
  for (const widget of widgets) {
    await request(
      '/metadata',
      `mutation($input:CreatePageLayoutWidgetInput!){ createPageLayoutWidget(input:$input){ id } }`,
      { input: { ...widget, pageLayoutTabId: tab.id } },
      token,
    );
  }
  return { id, pageLayoutId };
};

export const main = async () => {
  const token = await getToken();
  const ids = await loadFieldIds(token);
  const widgets = buildWidgets(ids);
  const plan = planDashboard(
    await findDashboards(token),
    widgets.map((widget) => widget.title),
  );
  if (plan.action === 'abort') throw new Error(plan.reason);
  let dashboardId;
  if (plan.action === 'skip') {
    dashboardId = plan.dashboard.id;
    console.log(`Dashboard já configurado (${dashboardId}).`);
  } else {
    dashboardId = (await createDashboard(token, widgets)).id;
    console.log(
      `Dashboard "${DASHBOARD_TITLE}" criado: ${dashboardId} (${widgets.length} widgets).`,
    );
  }
  await ensureNavigation(token, dashboardId, ids.dashboardObjectId);
};

// Só chamado com o dashboard já existente e completo (Gate: "apenas quando funcionando").
const ensureNavigation = async (token, dashboardId, dashboardObjectId) => {
  const meta = (query, variables) =>
    request('/metadata', query, variables, token);
  const { navigationMenuItems } = await meta(
    `{navigationMenuItems{id type position folderId userWorkspaceId targetRecordId}}`,
  );
  const plan = planDashboardNavigation(navigationMenuItems, dashboardId);
  if (plan.create) {
    // Desloca os demais antes para não haver duas posições 0.
    for (const move of plan.moves) {
      await meta(
        `mutation($input:UpdateOneNavigationMenuItemInput!){updateNavigationMenuItem(input:$input){id}}`,
        { input: { id: move.id, update: { position: move.position } } },
      );
    }
    await meta(
      `mutation($input:CreateNavigationMenuItemInput!){createNavigationMenuItem(input:$input){id}}`,
      {
        input: {
          type: 'RECORD',
          targetObjectMetadataId: dashboardObjectId,
          targetRecordId: dashboardId,
          position: plan.create.position,
        },
      },
    );
    console.log('navegação: "Visão Geral" criada em primeiro lugar.');
    return;
  }
  for (const move of plan.moves) {
    await meta(
      `mutation($input:UpdateOneNavigationMenuItemInput!){updateNavigationMenuItem(input:$input){id}}`,
      { input: { id: move.id, update: { position: move.position } } },
    );
  }
  console.log(`navegação: item já existe (${plan.moves.length} reordenados).`);
};

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
