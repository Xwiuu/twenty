// Testes da decisão de migração do pipeline. Rodar: node --test scripts/
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  main,
  planColumns,
  planNavigation,
  planStageUpdate,
} from './jean-crm-setup.mjs';

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

test('navegação padrão: remove o que sobra (pasta por último) e reordena os 5 itens', () => {
  const plan = planNavigation(defaultNavigation, objectNameById);
  assert.deepEqual(
    new Set(plan.remove),
    new Set(['n-dashboard', 'n-folder', 'n-workflow']),
  );
  assert.ok(
    plan.remove.indexOf('n-workflow') < plan.remove.indexOf('n-folder'),
  );
  assert.deepEqual(plan.moves, [
    { id: 'n-person', position: 0 },
    { id: 'n-company', position: 1 },
  ]);
});

test('navegação já simplificada: nada a fazer', () => {
  const simplified = [
    navItem('n-person', 'o2', 0),
    navItem('n-company', 'o1', 1),
    navItem('n-opportunity', 'o3', 2),
    navItem('n-task', 'o4', 3),
    navItem('n-note', 'o5', 4),
  ];
  assert.deepEqual(planNavigation(simplified, objectNameById), {
    remove: [],
    moves: [],
    create: [],
  });
});

test('navegação: itens pessoais de usuário não são tocados', () => {
  const personal = navItem('n-mine', 'o1', 0, { userWorkspaceId: 'user-1' });
  const plan = planNavigation([...defaultNavigation, personal], objectNameById);
  assert.ok(!plan.remove.includes('n-mine'));
});

test('navegação: item obrigatório ausente aborta e não planeja remoções', () => {
  const withoutTask = defaultNavigation.filter((item) => item.id !== 'n-task');
  const plan = planNavigation(withoutTask, objectNameById);
  assert.match(plan.abort, /task \(0 encontrados\)/);
  assert.equal(plan.remove, undefined);
  assert.equal(plan.moves, undefined);
});

test('navegação: item obrigatório duplicado aborta', () => {
  const duplicated = [...defaultNavigation, navItem('n-note-2', 'o5', 9)];
  assert.match(
    planNavigation(duplicated, objectNameById).abort,
    /note \(2 encontrados\)/,
  );
});

test('navegação: item obrigatório só dentro de pasta aborta', () => {
  const inFolder = defaultNavigation.map((item) =>
    item.id === 'n-note' ? { ...item, folderId: 'n-folder' } : item,
  );
  assert.match(
    planNavigation(inFolder, objectNameById).abort,
    /note \(0 encontrados\)/,
  );
});

test('navegação: item obrigatório só pessoal (não de workspace) aborta', () => {
  const personalOnly = defaultNavigation.map((item) =>
    item.id === 'n-task' ? { ...item, userWorkspaceId: 'user-1' } : item,
  );
  assert.match(
    planNavigation(personalOnly, objectNameById).abort,
    /task \(0 encontrados\)/,
  );
});

test('main: validação do menu falha antes de qualquer mutação de navegação', async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.TWENTY_API_KEY;
  process.env.TWENTY_API_KEY = 'chave-de-teste';
  const jeanStage = [
    'NEW',
    'CONTACTED',
    'QUALIFIED',
    'NEGOTIATION',
    'WON',
    'LOST',
  ].map(option);
  const objects = [
    {
      id: 'opp',
      nameSingular: 'opportunity',
      fieldsList: [
        { id: 'f-stage', name: 'stage', options: jeanStage },
        { id: 'f-interest', name: 'interesse', options: [] },
      ],
    },
    { id: 'o2', nameSingular: 'person', fieldsList: [] },
    { id: 'o5', nameSingular: 'note', fieldsList: [] },
    { id: 'o4', nameSingular: 'task', fieldsList: [] },
  ];
  // Menu sem Tarefas: a validação deve abortar.
  const menu = [
    navItem('n-person', 'o2', 0),
    navItem('n-opportunity', 'opp', 1),
    navItem('n-note', 'o5', 2),
    navItem('n-other', 'o1', 3),
  ];
  globalThis.fetch = async (_url, init) => {
    const { query } = JSON.parse(init.body);
    calls.push(query);
    let data = {};
    if (query.includes('objects(paging')) {
      data = { objects: { edges: objects.map((node) => ({ node })) } };
    } else if (query.includes('currentWorkspace')) {
      data = { currentWorkspace: { displayName: 'Jean CRM' } };
    } else if (query.includes('navigationMenuItems{')) {
      data = { navigationMenuItems: menu };
    } else if (query.includes('dashboards(')) {
      data = { dashboards: { edges: [] } };
    }
    return { json: async () => ({ data }) };
  };
  try {
    await assert.rejects(main(), /itens obrigatórios ausentes ou duplicados/);
    assert.equal(
      calls.filter((query) => /NavigationMenuItem\(/.test(query)).length,
      0,
      'nenhuma mutação de navegação deve ser enviada',
    );
    assert.equal(
      calls.some((query) => query.includes('getViews')),
      false,
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.TWENTY_API_KEY;
    else process.env.TWENTY_API_KEY = originalKey;
  }
});

test('navegação da Sprint 02 (4 itens, sem Empresas): planeja criar Empresas e reordenar', () => {
  const sprint02 = [
    navItem('n-person', 'o2', 0),
    navItem('n-opportunity', 'o3', 1),
    navItem('n-task', 'o4', 2),
    navItem('n-note', 'o5', 3),
  ];
  assert.deepEqual(planNavigation(sprint02, objectNameById), {
    remove: [],
    moves: [
      { id: 'n-opportunity', position: 2 },
      { id: 'n-task', position: 3 },
      { id: 'n-note', position: 4 },
    ],
    create: [{ name: 'company', position: 1 }],
  });
});

test('navegação: Empresas só dentro de pasta ou duplicada ainda aborta', () => {
  const inFolder = defaultNavigation.map((item) =>
    item.id === 'n-company' ? { ...item, folderId: 'n-folder' } : item,
  );
  assert.ok(planNavigation(inFolder, objectNameById).abort);
  const duplicated = [...defaultNavigation, navItem('n-company-2', 'o1', 9)];
  assert.ok(planNavigation(duplicated, objectNameById).abort);
});

test('navegação: outro item obrigatório ausente continua abortando (sem criar nada)', () => {
  const withoutTask = defaultNavigation.filter((item) => item.id !== 'n-task');
  const plan = planNavigation(withoutTask, objectNameById);
  assert.ok(plan.abort);
  assert.equal(plan.create, undefined);
  assert.equal(plan.remove, undefined);
});

// planColumns: mostra/ordena as colunas comerciais, oculta o resto (sem apagar) e cria o que falta.
const columnFieldIds = {
  name: 'f-name',
  emails: 'f-emails',
  phones: 'f-phones',
  company: 'f-company',
  city: 'f-city',
};
const viewField = (id, name, position, isVisible = true) => ({
  id,
  fieldMetadataId: columnFieldIds[name],
  position,
  isVisible,
});

test('colunas: oculta as irrelevantes, reordena e não cria o que já existe', () => {
  const fields = [
    viewField('v1', 'name', 0),
    viewField('v2', 'city', 1),
    viewField('v3', 'emails', 2),
    viewField('v4', 'company', 3),
    viewField('v5', 'phones', 4),
  ];
  const plan = planColumns(
    fields,
    ['name', 'emails', 'phones', 'company'],
    columnFieldIds,
  );
  assert.deepEqual(plan.creates, []);
  assert.deepEqual(
    plan.updates.sort((a, b) => a.id.localeCompare(b.id)),
    [
      { id: 'v2', update: { isVisible: false, position: 1 } },
      { id: 'v3', update: { isVisible: true, position: 1 } },
      { id: 'v5', update: { isVisible: true, position: 2 } },
    ],
  );
});

test('colunas: cria a coluna desejada que não existe na view', () => {
  const plan = planColumns(
    [viewField('v1', 'name', 0)],
    ['name', 'company'],
    columnFieldIds,
  );
  assert.deepEqual(plan.updates, []);
  assert.equal(plan.creates.length, 1);
  assert.equal(plan.creates[0].fieldMetadataId, 'f-company');
  assert.equal(plan.creates[0].position, 1);
});

test('colunas: já no layout desejado, nada a fazer (idempotente)', () => {
  const fields = [
    viewField('v1', 'name', 0),
    viewField('v2', 'emails', 1),
    viewField('v3', 'city', 5, false),
  ];
  assert.deepEqual(planColumns(fields, ['name', 'emails'], columnFieldIds), {
    updates: [],
    creates: [],
  });
});

const dashboardItem = (id, recordId, position, extra = {}) => ({
  id,
  type: 'RECORD',
  position,
  folderId: null,
  userWorkspaceId: null,
  targetObjectMetadataId: 'o-dashboard',
  targetRecordId: recordId,
  ...extra,
});

test('planNavigation: item do dashboard do Jean é protegido e fica em primeiro', () => {
  const menu = [
    dashboardItem('n-dash', 'dash-1', 0),
    navItem('n-person', 'o2', 1),
    navItem('n-company', 'o1', 2),
    navItem('n-opportunity', 'o3', 3),
    navItem('n-task', 'o4', 4),
    navItem('n-note', 'o5', 5),
  ];
  assert.deepEqual(planNavigation(menu, objectNameById, ['dash-1']), {
    remove: [],
    moves: [],
    create: [],
  });
});

test('planNavigation: dashboard fora de ordem volta para a primeira posição', () => {
  const menu = [
    navItem('n-person', 'o2', 0),
    navItem('n-company', 'o1', 1),
    navItem('n-opportunity', 'o3', 2),
    navItem('n-task', 'o4', 3),
    navItem('n-note', 'o5', 4),
    dashboardItem('n-dash', 'dash-1', 5),
  ];
  const plan = planNavigation(menu, objectNameById, ['dash-1']);
  assert.deepEqual(plan.remove, []);
  assert.deepEqual(
    Object.fromEntries(plan.moves.map((move) => [move.id, move.position])),
    {
      'n-dash': 0,
      'n-person': 1,
      'n-company': 2,
      'n-opportunity': 3,
      'n-task': 4,
      'n-note': 5,
    },
  );
});

test('planNavigation: sem o id do dashboard, item de registro continua sendo removido', () => {
  const menu = [
    dashboardItem('n-dash', 'dash-1', 0),
    navItem('n-person', 'o2', 1),
    navItem('n-company', 'o1', 2),
    navItem('n-opportunity', 'o3', 3),
    navItem('n-task', 'o4', 4),
    navItem('n-note', 'o5', 5),
  ];
  assert.deepEqual(planNavigation(menu, objectNameById, ['outro']).remove, [
    'n-dash',
  ]);
});

test('planNavigation: dois itens para o mesmo dashboard abortam sem alterar', () => {
  const menu = [
    dashboardItem('n-dash', 'dash-1', 0),
    dashboardItem('n-dash-2', 'dash-1', 1),
    navItem('n-person', 'o2', 2),
    navItem('n-company', 'o1', 3),
    navItem('n-opportunity', 'o3', 4),
    navItem('n-task', 'o4', 5),
    navItem('n-note', 'o5', 6),
  ];
  const plan = planNavigation(menu, objectNameById, ['dash-1']);
  assert.match(plan.abort, /2 itens apontam para o dashboard/);
  assert.equal(plan.remove, undefined);
});
