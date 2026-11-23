// Protege o formato da massa de demonstração. Rodar: node --test scripts/jean-crm-demo.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  adoptDemo,
  cleanDemo,
  DEMO_DEALS,
  DEMO_NOTES,
  loadDemo,
} from './jean-crm-demo.mjs';

const STAGES = ['NEW', 'CONTACTED', 'QUALIFIED', 'NEGOTIATION', 'WON', 'LOST'];

test('5 oportunidades de demo para Imóveis e 5 para Veículos', () => {
  assert.equal(
    DEMO_DEALS.filter((deal) => deal.interest === 'IMOVEIS').length,
    5,
  );
  assert.equal(
    DEMO_DEALS.filter((deal) => deal.interest === 'VEICULOS').length,
    5,
  );
  assert.equal(DEMO_DEALS.length, 10);
});

test('cada operação cobre ao menos 4 etapas e só usa etapas válidas', () => {
  for (const interest of ['IMOVEIS', 'VEICULOS']) {
    const stages = DEMO_DEALS.filter((deal) => deal.interest === interest).map(
      (deal) => deal.stage,
    );
    assert.ok(stages.every((stage) => STAGES.includes(stage)));
    assert.ok(new Set(stages).size >= 4);
  }
});

test('identificação exata: prefixo [DEMO] e e-mails example.test, sem repetição', () => {
  const unique = (values) => new Set(values).size === values.length;
  assert.ok(unique(DEMO_DEALS.map((deal) => deal.email)));
  assert.ok(unique(DEMO_DEALS.map((deal) => deal.opportunity)));
  assert.ok(unique(DEMO_DEALS.map((deal) => deal.task)));
  for (const deal of DEMO_DEALS) {
    assert.match(deal.email, /^demo-\d{2}@example\.test$/);
    assert.ok(deal.opportunity.startsWith('[DEMO] '));
    assert.ok(deal.task.startsWith('[DEMO] '));
    assert.ok(deal.firstName.startsWith('[DEMO] '));
  }
});

test('notas de demo apontam para oportunidades de demo existentes, uma por operação', () => {
  const names = DEMO_DEALS.map((deal) => deal.opportunity);
  assert.ok(
    DEMO_NOTES.every(
      (note) =>
        names.includes(note.opportunity) && note.title.startsWith('[DEMO] '),
    ),
  );
  const interests = DEMO_NOTES.map(
    (note) =>
      DEMO_DEALS.find((deal) => deal.opportunity === note.opportunity).interest,
  );
  assert.deepEqual(new Set(interests), new Set(['IMOVEIS', 'VEICULOS']));
});

// ---------------------------------------------------------------------------
// Fluxos de carga/adoção/limpeza com CRM e manifesto em memória.
// ---------------------------------------------------------------------------
class FakeCrm {
  constructor(workspace = 'ws-1') {
    this.workspace = workspace;
    this.sequence = 0;
    this.people = new Map();
    this.opportunities = new Map();
    this.tasks = new Map();
    this.notes = new Map();
    this.taskTargets = [];
    this.noteTargets = [];
    this.destroyed = [];
    this.failCreateTaskAt = null;
    this.taskCreations = 0;
  }
  next(prefix) {
    this.sequence += 1;
    return `${prefix}-${this.sequence}`;
  }
  total() {
    return [this.people, this.opportunities, this.tasks, this.notes].map(
      (map) => map.size,
    );
  }
  workspaceId = async () => this.workspace;
  list = (map, field, values) =>
    [...map.entries()]
      .filter(([, record]) => values.includes(record[field]))
      .map(([id, record]) => ({ id, key: record[field] }));
  listPeopleByEmails = async (values) =>
    this.list(this.people, 'email', values);
  listOpportunitiesByNames = async (values) =>
    this.list(this.opportunities, 'name', values);
  listTasksByTitles = async (values) => this.list(this.tasks, 'title', values);
  listNotesByTitles = async (values) => this.list(this.notes, 'title', values);
  getPerson = async (id) =>
    this.people.has(id) ? { id, ...this.people.get(id) } : null;
  getOpportunity = async (id) =>
    this.opportunities.has(id)
      ? {
          id,
          ...this.opportunities.get(id),
          taskIds: this.taskTargets
            .filter((t) => t.opportunityId === id)
            .map((t) => t.taskId),
          noteIds: this.noteTargets
            .filter((t) => t.opportunityId === id)
            .map((t) => t.noteId),
        }
      : null;
  getTask = async (id) =>
    this.tasks.has(id)
      ? {
          id,
          ...this.tasks.get(id),
          opportunityIds: this.taskTargets
            .filter((t) => t.taskId === id)
            .map((t) => t.opportunityId),
        }
      : null;
  getNote = async (id) =>
    this.notes.has(id)
      ? {
          id,
          ...this.notes.get(id),
          opportunityIds: this.noteTargets
            .filter((t) => t.noteId === id)
            .map((t) => t.opportunityId),
        }
      : null;
  createPerson = async (deal) => {
    const id = this.next('person');
    this.people.set(id, { email: deal.email, firstName: deal.firstName });
    return id;
  };
  createOpportunity = async (deal, pointOfContactId) => {
    const id = this.next('opp');
    this.opportunities.set(id, {
      name: deal.opportunity,
      interest: deal.interest,
      pointOfContactId,
    });
    return id;
  };
  createTask = async (title) => {
    this.taskCreations += 1;
    if (this.failCreateTaskAt === this.taskCreations)
      throw new Error('falha simulada');
    const id = this.next('task');
    this.tasks.set(id, { title });
    return id;
  };
  createTaskTarget = async (taskId, opportunityId) => {
    this.taskTargets.push({ taskId, opportunityId });
  };
  createNote = async (title) => {
    const id = this.next('note');
    this.notes.set(id, { title });
    return id;
  };
  createNoteTarget = async (noteId, opportunityId) => {
    this.noteTargets.push({ noteId, opportunityId });
  };
  destroy = async (type, id) => {
    this.destroyed.push(id);
    const map = {
      Person: this.people,
      Opportunity: this.opportunities,
      Task: this.tasks,
      Note: this.notes,
    }[type];
    map.delete(id);
    this.taskTargets = this.taskTargets.filter(
      (t) => t.taskId !== id && t.opportunityId !== id,
    );
    this.noteTargets = this.noteTargets.filter(
      (t) => t.noteId !== id && t.opportunityId !== id,
    );
  };
}

const memoryStore = () => {
  const store = {
    manifest: { version: 1, workspaces: {} },
    saves: 0,
    path: 'memória',
  };
  store.load = async () => structuredClone(store.manifest);
  store.save = async (manifest) => {
    store.saves += 1;
    store.manifest = structuredClone(manifest);
  };
  return store;
};

// Registros "reais" que já existiam antes da demo e não podem ser tocados.
const withPreexisting = () => {
  const crm = new FakeCrm();
  crm.people.set('real-person', {
    email: 'cliente.real@example.test',
    firstName: 'Cliente',
  });
  crm.opportunities.set('real-opp', {
    name: 'Negócio real',
    interest: null,
    pointOfContactId: 'real-person',
  });
  crm.tasks.set('real-task', { title: 'Tarefa real' });
  crm.notes.set('real-note', { title: 'Nota real' });
  return crm;
};
const PRE_TOTAL = [1, 1, 1, 1];

test('primeira carga cria somente os mocks e registra os UUIDs no manifesto', async () => {
  const crm = withPreexisting();
  const store = memoryStore();
  const created = await loadDemo(crm, store);
  assert.deepEqual(created, {
    people: 10,
    opportunities: 10,
    tasks: 10,
    notes: 2,
  });
  assert.deepEqual(crm.total(), [11, 11, 11, 3]);
  const entry = store.manifest.workspaces['ws-1'];
  assert.equal(Object.keys(entry.people).length, 10);
  assert.ok(
    Object.values(entry.opportunities).every((id) => crm.opportunities.has(id)),
  );
  for (const id of ['real-person', 'real-opp', 'real-task', 'real-note']) {
    assert.ok(
      !JSON.stringify(entry).includes(id),
      `${id} não pode estar no manifesto`,
    );
  }
});

test('segunda carga não duplica nada', async () => {
  const crm = withPreexisting();
  const store = memoryStore();
  await loadDemo(crm, store);
  const before = crm.total();
  const created = await loadDemo(crm, store);
  assert.deepEqual(created, {
    people: 0,
    opportunities: 0,
    tasks: 0,
    notes: 0,
  });
  assert.deepEqual(crm.total(), before);
  assert.equal(crm.taskTargets.length, 10);
});

test('registro preexistente com o mesmo nome não é assumido como demo (carga bloqueada)', async () => {
  const crm = withPreexisting();
  crm.people.set('lookalike', {
    email: DEMO_DEALS[0].email,
    firstName: 'Outra pessoa',
  });
  crm.tasks.set('lookalike-task', { title: DEMO_DEALS[3].task });
  const store = memoryStore();
  await assert.rejects(loadDemo(crm, store), /não estão no manifesto/);
  assert.deepEqual(crm.total(), [2, 1, 2, 1], 'nada foi criado');
  assert.equal(store.saves, 0);
});

test('limpeza sem manifesto é bloqueada e nada é removido', async () => {
  const crm = withPreexisting();
  await loadDemo(crm, memoryStore());
  const emptyStore = memoryStore();
  await assert.rejects(
    cleanDemo(crm, emptyStore, { confirm: true }),
    /não há manifesto/,
  );
  assert.equal(crm.destroyed.length, 0);
});

test('limpeza em outro workspace é bloqueada', async () => {
  const crm = withPreexisting();
  const store = memoryStore();
  await loadDemo(crm, store);
  crm.workspace = 'ws-2';
  await assert.rejects(
    cleanDemo(crm, store, { confirm: true }),
    /não há manifesto/,
  );
  assert.equal(crm.destroyed.length, 0);
});

test('ID do manifesto que aponta para outro registro bloqueia a limpeza', async () => {
  const crm = withPreexisting();
  const store = memoryStore();
  await loadDemo(crm, store);
  const id =
    store.manifest.workspaces['ws-1'].opportunities[DEMO_DEALS[0].opportunity];
  crm.opportunities.get(id).name = 'Outro negócio';
  await assert.rejects(
    cleanDemo(crm, store, { confirm: true }),
    /diverge do esperado/,
  );
  assert.equal(crm.destroyed.length, 0);
});

test('relação inesperada (tarefa extra ligada à demo) bloqueia a limpeza', async () => {
  const crm = withPreexisting();
  const store = memoryStore();
  await loadDemo(crm, store);
  const id =
    store.manifest.workspaces['ws-1'].opportunities[DEMO_DEALS[1].opportunity];
  crm.taskTargets.push({ taskId: 'real-task', opportunityId: id });
  await assert.rejects(
    cleanDemo(crm, store, { confirm: true }),
    /tarefas vinculadas diferentes/,
  );
  assert.equal(crm.destroyed.length, 0);
});

test('duplicidade criada depois da carga bloqueia a limpeza', async () => {
  const crm = withPreexisting();
  const store = memoryStore();
  await loadDemo(crm, store);
  crm.tasks.set('copy', { title: DEMO_DEALS[0].task });
  await assert.rejects(
    cleanDemo(crm, store, { confirm: true }),
    /duplicidade\/conflito/,
  );
  assert.equal(crm.destroyed.length, 0);
});

test('dry-run (sem --confirm) não remove nada', async () => {
  const crm = withPreexisting();
  const store = memoryStore();
  await loadDemo(crm, store);
  const result = await cleanDemo(crm, store, { confirm: false });
  assert.equal(result.removed, false);
  assert.equal(crm.destroyed.length, 0);
  assert.ok(store.manifest.workspaces['ws-1']);
});

test('limpeza válida remove somente os registros do manifesto e preserva os preexistentes', async () => {
  const crm = withPreexisting();
  const store = memoryStore();
  await loadDemo(crm, store);
  const owned = Object.values(store.manifest.workspaces['ws-1']).flatMap(
    (value) => (typeof value === 'object' ? Object.values(value) : []),
  );
  const result = await cleanDemo(crm, store, { confirm: true });
  assert.equal(result.removed, true);
  assert.deepEqual(new Set(crm.destroyed), new Set(owned));
  assert.deepEqual(crm.total(), PRE_TOTAL);
  assert.ok(crm.people.has('real-person') && crm.opportunities.has('real-opp'));
  assert.ok(crm.tasks.has('real-task') && crm.notes.has('real-note'));
  assert.equal(store.manifest.workspaces['ws-1'], undefined);
});

test('carga interrompida preserva os ids criados e a repetição completa sem duplicar', async () => {
  const crm = withPreexisting();
  const store = memoryStore();
  crm.failCreateTaskAt = 4;
  await assert.rejects(loadDemo(crm, store), /falha simulada/);
  const partial = store.manifest.workspaces['ws-1'];
  assert.equal(Object.keys(partial.tasks).length, 3);
  assert.equal(Object.keys(partial.opportunities).length, 4);
  crm.failCreateTaskAt = null;
  await loadDemo(crm, store);
  assert.deepEqual(crm.total(), [11, 11, 11, 3]);
  assert.equal(crm.taskTargets.length, 10);
});

test('adoção: dry-run não grava; --confirm adota mocks sem manifesto e habilita a limpeza', async () => {
  const crm = withPreexisting();
  await loadDemo(crm, memoryStore()); // cria mocks "órfãos" (manifesto descartado)
  const store = memoryStore();
  await assert.rejects(
    cleanDemo(crm, store, { confirm: true }),
    /não há manifesto/,
  );
  await assert.rejects(loadDemo(crm, store), /não estão no manifesto/);

  const dry = await adoptDemo(crm, store, { confirm: false });
  assert.deepEqual(dry, { adopted: false, total: 32 });
  assert.equal(store.saves, 0);

  assert.deepEqual(await adoptDemo(crm, store, { confirm: true }), {
    adopted: true,
    total: 32,
  });
  const created = await loadDemo(crm, store);
  assert.deepEqual(created, {
    people: 0,
    opportunities: 0,
    tasks: 0,
    notes: 0,
  });
  await cleanDemo(crm, store, { confirm: true });
  assert.deepEqual(crm.total(), PRE_TOTAL);
});

test('adoção é recusada quando as relações não são as da demo', async () => {
  const crm = withPreexisting();
  await loadDemo(crm, memoryStore());
  const opportunityId = [...crm.opportunities.entries()].find(
    ([, o]) => o.name === DEMO_DEALS[2].opportunity,
  )[0];
  crm.taskTargets.push({ taskId: 'real-task', opportunityId });
  const store = memoryStore();
  await assert.rejects(
    adoptDemo(crm, store, { confirm: true }),
    /Adoção abortada/,
  );
  assert.equal(store.saves, 0);
});

// UUID registrado no manifesto mas ausente no CRM: a limpeza deve bloquear, não ignorar.
for (const [kind, mapName, label] of [
  ['people', 'people', 'pessoa'],
  ['opportunities', 'opportunities', 'oportunidade'],
  ['tasks', 'tasks', 'tarefa'],
  ['notes', 'notes', 'nota'],
]) {
  test(`UUID de ${label} ausente no CRM bloqueia a limpeza e preserva o manifesto`, async () => {
    const crm = withPreexisting();
    const store = memoryStore();
    await loadDemo(crm, store);
    const manifestBefore = structuredClone(store.manifest);
    const missingId = Object.values(store.manifest.workspaces['ws-1'][kind])[0];
    crm[mapName].delete(missingId);
    const totalBefore = crm.total();

    await assert.rejects(
      cleanDemo(crm, store, { confirm: true }),
      new RegExp(`${label} ${missingId} .*ausente no CRM`),
    );
    assert.equal(crm.destroyed.length, 0, 'zero exclusões');
    assert.deepEqual(crm.total(), totalBefore);
    assert.deepEqual(store.manifest, manifestBefore, 'manifesto preservado');
    await assert.rejects(
      cleanDemo(crm, store, { confirm: false }),
      /ausente no CRM/,
    );
  });
}

test('recuperação: recarregar recria o UUID ausente e a limpeza válida volta a funcionar', async () => {
  const crm = withPreexisting();
  const store = memoryStore();
  await loadDemo(crm, store);
  const missingId = Object.values(store.manifest.workspaces['ws-1'].tasks)[0];
  crm.tasks.delete(missingId);
  crm.taskTargets = crm.taskTargets.filter(
    (target) => target.taskId !== missingId,
  );
  await assert.rejects(
    cleanDemo(crm, store, { confirm: true }),
    /ausente no CRM/,
  );

  const created = await loadDemo(crm, store);
  assert.deepEqual(created, {
    people: 0,
    opportunities: 0,
    tasks: 1,
    notes: 0,
  });
  const result = await cleanDemo(crm, store, { confirm: true });
  assert.equal(result.removed, true);
  assert.deepEqual(crm.total(), PRE_TOTAL);
  assert.equal(store.manifest.workspaces['ws-1'], undefined);
});
