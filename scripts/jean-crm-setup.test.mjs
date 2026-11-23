// Testes da decisão de migração do pipeline. Rodar: node --test scripts/
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { planNavigation, planStageUpdate } from './jean-crm-setup.mjs';

const option = (value, position) => ({ id: `id-${value}`, value, position });

const stock = ['NEW', 'SCREENING', 'MEETING', 'PROPOSAL', 'CUSTOMER'].map(
  option,
);
const jean = [
  'NEW',
  'CONTACTED',
  'QUALIFIED',
  'NEGOTIATION',
  'WON',
  'LOST',
].map(option);

test('pipeline padrão: migra preservando os ids das opções existentes', () => {
  const plan = planStageUpdate(stock);
  assert.equal(plan.action, 'update');
  assert.deepEqual(
    plan.options.map((item) => item.value),
    ['NEW', 'CONTACTED', 'QUALIFIED', 'NEGOTIATION', 'WON', 'LOST'],
  );
  assert.deepEqual(
    plan.options.map((item) => item.id),
    [
      'id-NEW',
      'id-SCREENING',
      'id-MEETING',
      'id-PROPOSAL',
      'id-CUSTOMER',
      undefined,
    ],
  );
});

test('etapa extra: aborta', () => {
  const plan = planStageUpdate([...stock, option('MINHA_ETAPA', 5)]);
  assert.equal(plan.action, 'abort');
  assert.equal(plan.options, undefined);
});

test('etapa ausente: aborta', () => {
  assert.equal(planStageUpdate(stock.slice(0, 4)).action, 'abort');
});

test('etapa duplicada: aborta', () => {
  const duplicated = [...stock.slice(0, 4), option('MEETING', 4)];
  assert.equal(planStageUpdate(duplicated).action, 'abort');
});

test('etapa trocada por outra desconhecida (mesmo total): aborta', () => {
  const swapped = [...stock.slice(0, 4), option('OUTRA', 4)];
  assert.equal(planStageUpdate(swapped).action, 'abort');
});

test('pipeline do Jean já configurado: não altera nada', () => {
  assert.equal(planStageUpdate(jean).action, 'skip');
});

test('pipeline do Jean com etapa extra: aborta', () => {
  assert.equal(
    planStageUpdate([...jean, option('MINHA_ETAPA', 6)]).action,
    'abort',
  );
});

const objectNameById = {
  o1: 'company',
  o2: 'person',
  o3: 'opportunity',
  o4: 'task',
  o5: 'note',
  o6: 'workflow',
  o7: 'dashboard',
};
const navItem = (id, objectId, position, extra = {}) => ({
  id,
  type: 'OBJECT',
  position,
  folderId: null,
  userWorkspaceId: null,
  targetObjectMetadataId: objectId,
  ...extra,
});
const defaultNavigation = [
  navItem('n-company', 'o1', 0),
  navItem('n-person', 'o2', 1),
  navItem('n-opportunity', 'o3', 2),
  navItem('n-task', 'o4', 3),
  navItem('n-note', 'o5', 4),
  navItem('n-dashboard', 'o7', 5),
  {
    id: 'n-folder',
    type: 'FOLDER',
    position: 6,
    folderId: null,
    userWorkspaceId: null,
  },
  navItem('n-workflow', 'o6', 0, { folderId: 'n-folder' }),
];

test('navegação padrão: remove o que sobra (pasta por último) e reordena os 4 itens', () => {
  const plan = planNavigation(defaultNavigation, objectNameById);
  assert.deepEqual(
    new Set(plan.remove),
    new Set(['n-company', 'n-dashboard', 'n-folder', 'n-workflow']),
  );
  assert.ok(
    plan.remove.indexOf('n-workflow') < plan.remove.indexOf('n-folder'),
  );
  assert.deepEqual(plan.moves, [
    { id: 'n-person', position: 0 },
    { id: 'n-opportunity', position: 1 },
    { id: 'n-task', position: 2 },
    { id: 'n-note', position: 3 },
  ]);
});

test('navegação já simplificada: nada a fazer', () => {
  const simplified = [
    navItem('n-person', 'o2', 0),
    navItem('n-opportunity', 'o3', 1),
    navItem('n-task', 'o4', 2),
    navItem('n-note', 'o5', 3),
  ];
  assert.deepEqual(planNavigation(simplified, objectNameById), {
    remove: [],
    moves: [],
  });
});

test('navegação: itens pessoais de usuário não são tocados', () => {
  const personal = navItem('n-mine', 'o1', 0, { userWorkspaceId: 'user-1' });
  const plan = planNavigation([...defaultNavigation, personal], objectNameById);
  assert.ok(!plan.remove.includes('n-mine'));
});
