import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildWidgets,
  planDashboard,
  planDashboardNavigation,
} from './jean-crm-dashboard.mjs';

const ids = {
  opportunity: {
    objectId: 'o-opp',
    fields: { id: 'f-opp-id', interesse: 'f-int', stage: 'f-stage' },
  },
  task: { objectId: 'o-task', fields: { id: 'f-task-id', status: 'f-status' } },
};

test('buildWidgets: um widget por indicador pedido, sem números fixos', () => {
  const widgets = buildWidgets(ids);
  assert.deepEqual(
    widgets.map((widget) => widget.title),
    [
      'Total de oportunidades',
      'Oportunidades de Imóveis',
      'Oportunidades de Veículos',
      'Oportunidades por etapa',
      'Tarefas pendentes',
      'Tarefas concluídas',
    ],
  );
  // só COUNT (nenhum valor de venda, faturamento ou comissão)
  for (const widget of widgets) {
    assert.equal(widget.configuration.aggregateOperation, 'COUNT');
  }
});

test('buildWidgets: Imóveis e Veículos filtram interesses distintos', () => {
  const byTitle = Object.fromEntries(
    buildWidgets(ids).map((widget) => [widget.title, widget]),
  );
  const filterOf = (title) =>
    byTitle[title].configuration.filter.recordFilters[0];
  assert.equal(filterOf('Oportunidades de Imóveis').value, '["IMOVEIS"]');
  assert.equal(filterOf('Oportunidades de Veículos').value, '["VEICULOS"]');
  assert.equal(filterOf('Oportunidades de Imóveis').fieldMetadataId, 'f-int');
  assert.equal(
    byTitle['Total de oportunidades'].configuration.filter,
    undefined,
  );
});

test('buildWidgets: tarefas pendentes = TODO + IN_PROGRESS; concluídas = DONE', () => {
  const byTitle = Object.fromEntries(
    buildWidgets(ids).map((widget) => [widget.title, widget]),
  );
  const valueOf = (title) =>
    byTitle[title].configuration.filter.recordFilters[0].value;
  assert.equal(valueOf('Tarefas pendentes'), '["TODO","IN_PROGRESS"]');
  assert.equal(valueOf('Tarefas concluídas'), '["DONE"]');
});

test('buildWidgets: nenhum widget se sobrepõe na grade de 12 colunas', () => {
  const cells = new Set();
  for (const { gridPosition: g } of buildWidgets(ids)) {
    assert.ok(g.column + g.columnSpan <= 12);
    for (let r = g.row; r < g.row + g.rowSpan; r++)
      for (let c = g.column; c < g.column + g.columnSpan; c++) {
        assert.ok(!cells.has(`${r}:${c}`), `sobreposição em ${r}:${c}`);
        cells.add(`${r}:${c}`);
      }
  }
});

const wanted = buildWidgets(ids);

// Simula o que a API devolve: mesmos dados, mais propriedades cosméticas/padrão do Twenty.
const asStored = (widget, index) => ({
  id: `w${index}`,
  ...structuredClone(widget),
  gridPosition: { row: 9, column: 9, rowSpan: 1, columnSpan: 1 },
  configuration: {
    ...structuredClone(widget.configuration),
    color: 'blue',
    timezone: 'America/Sao_Paulo',
    firstDayOfTheWeek: 1,
    ...(widget.configuration.filter
      ? {
          filter: {
            recordFilterGroups: null,
            recordFilters: widget.configuration.filter.recordFilters.map(
              (item) => ({ ...item, label: 'Outro rótulo', displayValue: 'x' }),
            ),
          },
        }
      : {}),
  },
});
const stored = () => wanted.map(asStored);
const dashboardWith = (widgets) => [{ id: 'd1', widgets }];
const change = (title, edit) =>
  stored().map((widget) => {
    if (widget.title !== title) return widget;
    edit(widget);
    return widget;
  });

test('planDashboard: cria quando não existe', () => {
  assert.deepEqual(planDashboard([], wanted), { action: 'create' });
});

test('planDashboard: configuração correta (mesmo com diferenças cosméticas) é ignorada', () => {
  assert.equal(
    planDashboard(dashboardWith(stored().reverse()), wanted).action,
    'skip',
  );
});

test('planDashboard: ordem dos valores do filtro de status não importa', () => {
  const widgets = change('Tarefas pendentes', (widget) => {
    widget.configuration.filter.recordFilters[0].value =
      '["IN_PROGRESS","TODO"]';
  });
  assert.equal(planDashboard(dashboardWith(widgets), wanted).action, 'skip');
});

test('planDashboard: filtro de Imóveis trocado por Veículos aborta', () => {
  const widgets = change('Oportunidades de Imóveis', (widget) => {
    widget.configuration.filter.recordFilters[0].value = '["VEICULOS"]';
  });
  const plan = planDashboard(dashboardWith(widgets), wanted);
  assert.equal(plan.action, 'abort');
  assert.match(plan.reason, /"Oportunidades de Imóveis" diverge em filter/);
});

test('planDashboard: status de tarefas alterado aborta', () => {
  const widgets = change('Tarefas concluídas', (widget) => {
    widget.configuration.filter.recordFilters[0].value = '["TODO"]';
  });
  assert.equal(planDashboard(dashboardWith(widgets), wanted).action, 'abort');
});

test('planDashboard: filtro removido de um indicador aborta', () => {
  const widgets = change('Oportunidades de Veículos', (widget) => {
    delete widget.configuration.filter;
  });
  assert.equal(planDashboard(dashboardWith(widgets), wanted).action, 'abort');
});

test('planDashboard: agregação ou campo errado aborta', () => {
  const operation = change('Total de oportunidades', (widget) => {
    widget.configuration.aggregateOperation = 'SUM';
  });
  assert.match(
    planDashboard(dashboardWith(operation), wanted).reason,
    /aggregateOperation/,
  );
  const field = change('Total de oportunidades', (widget) => {
    widget.configuration.aggregateFieldMetadataId = 'f-amount';
  });
  assert.match(
    planDashboard(dashboardWith(field), wanted).reason,
    /aggregateFieldMetadataId/,
  );
});

test('planDashboard: gráfico de etapas agrupado por outro campo aborta', () => {
  const widgets = change('Oportunidades por etapa', (widget) => {
    widget.configuration.primaryAxisGroupByFieldMetadataId = 'f-int';
  });
  const plan = planDashboard(dashboardWith(widgets), wanted);
  assert.match(plan.reason, /groupByFieldMetadataId/);
});

test('planDashboard: objeto ou tipo de widget diferente aborta', () => {
  const widgets = change('Tarefas pendentes', (widget) => {
    widget.objectMetadataId = 'o-opp';
  });
  assert.match(
    planDashboard(dashboardWith(widgets), wanted).reason,
    /objectMetadataId/,
  );
});

test('planDashboard: widget ausente, duplicado ou extra aborta', () => {
  const missing = stored().slice(1);
  assert.match(planDashboard(dashboardWith(missing), wanted).reason, /ausente/);
  const duplicated = [...stored(), stored()[0]];
  assert.match(
    planDashboard(dashboardWith(duplicated), wanted).reason,
    /duplicado/,
  );
  const extra = [...stored(), { ...stored()[0], title: 'Outro' }];
  assert.match(
    planDashboard(dashboardWith(extra), wanted).reason,
    /inesperado/,
  );
});

test('planDashboard: dashboards duplicados abortam', () => {
  const plan = planDashboard(
    [
      { id: 'd1', widgets: stored() },
      { id: 'd2', widgets: stored() },
    ],
    wanted,
  );
  assert.equal(plan.action, 'abort');
});

const item = (id, position, extra = {}) => ({
  id,
  type: 'OBJECT',
  position,
  folderId: null,
  userWorkspaceId: null,
  ...extra,
});

test('planDashboardNavigation: cria em primeiro e desloca os demais', () => {
  const plan = planDashboardNavigation(
    [item('a', 0), item('b', 1), item('c', 2)],
    'dash-1',
  );
  assert.deepEqual(plan.create, { position: 0 });
  assert.deepEqual(plan.moves, [
    { id: 'a', position: 1 },
    { id: 'b', position: 2 },
    { id: 'c', position: 3 },
  ]);
});

test('planDashboardNavigation: não faz nada se o item já existe em primeiro', () => {
  const plan = planDashboardNavigation(
    [item('d', 0, { type: 'RECORD', targetRecordId: 'dash-1' }), item('a', 1)],
    'dash-1',
  );
  assert.deepEqual(plan, { create: null, moves: [] });
});

test('planDashboardNavigation: ignora itens pessoais ao calcular posições', () => {
  const plan = planDashboardNavigation(
    [item('a', 0), item('mine', 0, { userWorkspaceId: 'u1' })],
    'dash-1',
  );
  assert.deepEqual(plan.moves, [{ id: 'a', position: 1 }]);
});
