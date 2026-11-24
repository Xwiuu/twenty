import assert from 'node:assert/strict';
import test from 'node:test';
import {
  KANBAN_NAME,
  planKanbanView,
  planStatusLabels,
} from './jean-crm-tasks-kanban.mjs';

const option = (value, label, position) => ({
  id: `id-${value}`,
  value,
  label,
  color: 'gray',
  position,
});
const stockStatus = [
  option('TODO', 'To do', 0),
  option('IN_PROGRESS', 'In progress', 1),
  option('DONE', 'Done', 2),
];

test('planStatusLabels: troca só os rótulos e preserva id, valor, cor e posição', () => {
  const plan = planStatusLabels(stockStatus);
  assert.equal(plan.action, 'update');
  assert.deepEqual(
    plan.options.map((item) => [item.id, item.value, item.label, item.color]),
    [
      ['id-TODO', 'TODO', 'A fazer', 'gray'],
      ['id-IN_PROGRESS', 'IN_PROGRESS', 'Em andamento', 'gray'],
      ['id-DONE', 'DONE', 'Concluídas', 'gray'],
    ],
  );
});

test('planStatusLabels: já em português, nada a fazer (idempotente)', () => {
  const done = planStatusLabels(stockStatus).options;
  assert.deepEqual(planStatusLabels(done), { action: 'skip' });
});

test('planStatusLabels: opção extra, faltando ou duplicada aborta', () => {
  assert.equal(
    planStatusLabels([...stockStatus, option('BLOCKED', 'Blocked', 3)]).action,
    'abort',
  );
  assert.equal(planStatusLabels(stockStatus.slice(1)).action, 'abort');
  assert.equal(
    planStatusLabels([...stockStatus.slice(0, 2), option('TODO', 'x', 2)])
      .action,
    'abort',
  );
});

const group = (fieldValue, position, isVisible = true) => ({
  fieldValue,
  position,
  isVisible,
});
const cardField = (fieldMetadataId, isVisible = true) => ({
  fieldMetadataId,
  isVisible,
});
const cardIds = { title: 'f-title', dueAt: 'f-due', assignee: 'f-assignee' };
const goodView = (extra = {}) => ({
  id: 'v1',
  name: KANBAN_NAME,
  type: 'KANBAN',
  mainGroupByFieldMetadataId: 'f-status',
  viewGroups: [
    group('TODO', 0),
    group('IN_PROGRESS', 1),
    group('DONE', 2),
    group('', 3),
  ],
  viewFields: [
    cardField('f-title'),
    cardField('f-due'),
    cardField('f-assignee'),
  ],
  ...extra,
});
const other = { id: 'v0', name: 'All Tasks', type: 'TABLE', viewGroups: [] };

test('planKanbanView: cria quando não existe, preservando a lista', () => {
  assert.deepEqual(planKanbanView([other], 'f-status', cardIds), {
    action: 'create',
  });
});

test('planKanbanView: view correta (com coluna nativa "sem valor") é ignorada', () => {
  assert.equal(
    planKanbanView([other, goodView()], 'f-status', cardIds).action,
    'skip',
  );
});

test('planKanbanView: não duplica em segunda execução', () => {
  assert.notEqual(
    planKanbanView([other, goodView()], 'f-status', cardIds).action,
    'create',
  );
});

test('planKanbanView: duas views com o mesmo nome abortam', () => {
  const plan = planKanbanView(
    [goodView(), goodView({ id: 'v2' })],
    'f-status',
    cardIds,
  );
  assert.equal(plan.action, 'abort');
  assert.match(plan.reason, /2 views/);
});

test('planKanbanView: tipo, agrupamento ou colunas divergentes abortam', () => {
  const wrongType = planKanbanView(
    [goodView({ type: 'TABLE' })],
    'f-status',
    cardIds,
  );
  assert.match(wrongType.reason, /KANBAN/);
  const wrongField = planKanbanView([goodView()], 'outro-campo', cardIds);
  assert.match(wrongField.reason, /não agrupa por status/);
  const duplicated = planKanbanView(
    [goodView({ viewGroups: [...goodView().viewGroups, group('TODO', 4)] })],
    'f-status',
  );
  assert.match(duplicated.reason, /colunas diferentes/);
  const hidden = planKanbanView(
    [
      goodView({
        viewGroups: [
          group('TODO', 0),
          group('IN_PROGRESS', 1, false),
          group('DONE', 2),
        ],
      }),
    ],
    'f-status',
  );
  assert.equal(hidden.action, 'abort');
});

test('planKanbanView: campo do cartão ausente aborta (view criada pela metade)', () => {
  const plan = planKanbanView(
    [goodView({ viewFields: [cardField('f-title'), cardField('f-due')] })],
    'f-status',
    cardIds,
  );
  assert.equal(plan.action, 'abort');
  assert.match(plan.reason, /campo assignee ausente/);
});

test('planKanbanView: view sem nenhum campo de cartão aborta', () => {
  const plan = planKanbanView(
    [goodView({ viewFields: [] })],
    'f-status',
    cardIds,
  );
  assert.equal(plan.action, 'abort');
  assert.match(plan.reason, /title ausente.*dueAt ausente.*assignee ausente/);
});

test('planKanbanView: campo do cartão oculto aborta', () => {
  const plan = planKanbanView(
    [
      goodView({
        viewFields: [
          cardField('f-title'),
          cardField('f-due', false),
          cardField('f-assignee'),
        ],
      }),
    ],
    'f-status',
    cardIds,
  );
  assert.match(plan.reason, /campo dueAt oculto/);
});

test('planKanbanView: campo do cartão duplicado aborta', () => {
  const plan = planKanbanView(
    [
      goodView({
        viewFields: [
          cardField('f-title'),
          cardField('f-title'),
          cardField('f-due'),
          cardField('f-assignee'),
        ],
      }),
    ],
    'f-status',
    cardIds,
  );
  assert.match(plan.reason, /campo title duplicado/);
});

test('planKanbanView: campos extras (outras colunas do cartão) não impedem o skip', () => {
  const plan = planKanbanView(
    [
      goodView({
        viewFields: [...goodView().viewFields, cardField('f-other')],
      }),
    ],
    'f-status',
    cardIds,
  );
  assert.equal(plan.action, 'skip');
});
