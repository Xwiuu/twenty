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

const titles = buildWidgets(ids).map((widget) => widget.title);

test('planDashboard: cria quando não existe', () => {
  assert.deepEqual(planDashboard([], titles), { action: 'create' });
});

test('planDashboard: ignora quando já tem exatamente os widgets', () => {
  const existing = [{ id: 'd1', widgetTitles: [...titles].reverse() }];
  assert.equal(planDashboard(existing, titles).action, 'skip');
});

test('planDashboard: aborta se existir com widgets diferentes ou duplicado', () => {
  assert.equal(
    planDashboard([{ id: 'd1', widgetTitles: ['Outro'] }], titles).action,
    'abort',
  );
  assert.equal(
    planDashboard(
      [
        { id: 'd1', widgetTitles: titles },
        { id: 'd2', widgetTitles: titles },
      ],
      titles,
    ).action,
    'abort',
  );
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
