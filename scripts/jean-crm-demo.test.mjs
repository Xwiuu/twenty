// Protege o formato da massa de demonstração. Rodar: node --test scripts/jean-crm-demo.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  adoptDemo,
  cleanDemo,
  DEMO_COMPANIES,
  DEMO_DEALS,
  DEMO_NOTES,
  loadDemo,
  migrateManifest,
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
    this.companies = new Map();
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
  listCompaniesByNames = async (values) =>
    this.list(this.companies, 'name', values);
  getCompany = async (id) =>
    this.companies.has(id)
      ? {
          id,
          name: this.companies.get(id).name,
          personIds: [...this.people.entries()]
            .filter(([, person]) => person.companyId === id)
            .map(([personId]) => personId),
          opportunityIds: [...this.opportunities.entries()]
            .filter(([, opportunity]) => opportunity.companyId === id)
            .map(([opportunityId]) => opportunityId),
        }
      : null;
  createCompany = async (name) => {
    const id = this.next('company');
    this.companies.set(id, { name });
    return id;
  };
  setCompany = async (type, id, companyId) => {
    const map = type === 'Person' ? this.people : this.opportunities;
    map.get(id).companyId = companyId;
  };
  getPerson = async (id) =>
    this.people.has(id)
      ? {
          id,
          ...this.people.get(id),
          companyId: this.people.get(id).companyId ?? null,
        }
      : null;
  getOpportunity = async (id) =>
    this.opportunities.has(id)
      ? {
          id,
          ...this.opportunities.get(id),
          companyId: this.opportunities.get(id).companyId ?? null,
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
  createPerson = async (deal, companyId = null) => {
    const id = this.next('person');
    this.people.set(id, {
      email: deal.email,
      firstName: deal.firstName,
      companyId,
    });
    return id;
  };
  createOpportunity = async (deal, pointOfContactId, companyId = null) => {
    const id = this.next('opp');
    this.opportunities.set(id, {
      name: deal.opportunity,
      interest: deal.interest,
      pointOfContactId,
      companyId,
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
      Company: this.companies,
      Person: this.people,
      Opportunity: this.opportunities,
      Task: this.tasks,
      Note: this.notes,
    }[type];
    map.delete(id);
    // O Twenty zera o vínculo dos registros que apontavam para a empresa removida.
    for (const record of [
      ...this.people.values(),
      ...this.opportunities.values(),
    ]) {
      if (record.companyId === id) record.companyId = null;
    }
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
    manifest: { version: 2, workspaces: {} },
    saves: 0,
    path: 'memória',
  };
  // como o armazenamento real, migra ao ler
  store.load = async () => migrateManifest(structuredClone(store.manifest));
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

// Estado da Sprint 02.3: mocks sem empresa. Remove empresas e vínculos do CRM e, se houver
// manifesto, devolve-o ao formato v1 (sem `companies`).
const toLegacy = (crm, store) => {
  crm.companies.clear();
  for (const record of [
    ...crm.people.values(),
    ...crm.opportunities.values(),
  ]) {
    record.companyId = null;
  }
  if (store) {
    store.manifest.version = 1;
    for (const entry of Object.values(store.manifest.workspaces))
      delete entry.companies;
  }
};

test('primeira carga cria somente os mocks e registra os UUIDs no manifesto', async () => {
  const crm = withPreexisting();
  const store = memoryStore();
  const created = await loadDemo(crm, store);
  assert.deepEqual(created, {
    companies: 2,
    people: 10,
    opportunities: 10,
    tasks: 10,
    notes: 2,
  });
  assert.deepEqual(crm.total(), [11, 11, 11, 3]);
  assert.equal(crm.companies.size, 2);
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
    companies: 0,
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
  toLegacy(crm); // como na Sprint 02.3: sem empresas
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
    companies: 2,
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
  toLegacy(crm);
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
    companies: 0,
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

// ---------------------------------------------------------------------------
// Sprint 02.4: empresas demonstrativas (Company) e evolução do manifesto v1 → v2.
// ---------------------------------------------------------------------------
const companyId = (store, interest) =>
  store.manifest.workspaces['ws-1'].companies[
    DEMO_COMPANIES.find((company) => company.interest === interest).name
  ];

test('carga cria exatamente duas empresas e vincula 5+5 contatos e oportunidades por interesse', async () => {
  const crm = withPreexisting();
  const store = memoryStore();
  await loadDemo(crm, store);
  assert.equal(crm.companies.size, 2);
  assert.deepEqual(
    [...crm.companies.values()].map((company) => company.name).sort(),
    DEMO_COMPANIES.map((company) => company.name).sort(),
  );
  for (const interest of ['IMOVEIS', 'VEICULOS']) {
    const company = await crm.getCompany(companyId(store, interest));
    assert.equal(company.personIds.length, 5);
    assert.equal(company.opportunityIds.length, 5);
    for (const id of company.opportunityIds) {
      assert.equal(crm.opportunities.get(id).interest, interest);
    }
  }
});

test('registros preexistentes não ganham empresa (a real continua sem vínculo)', async () => {
  const crm = withPreexisting();
  await loadDemo(crm, memoryStore());
  assert.equal(crm.people.get('real-person').companyId ?? null, null);
  assert.equal(crm.opportunities.get('real-opp').companyId ?? null, null);
});

test('empresa preexistente com o mesmo nome não é reivindicada (carga bloqueada, nada criado)', async () => {
  const crm = withPreexisting();
  crm.companies.set('real-company', { name: DEMO_COMPANIES[0].name });
  const store = memoryStore();
  await assert.rejects(loadDemo(crm, store), /não estão no manifesto/);
  assert.equal(crm.companies.size, 1);
  assert.deepEqual(crm.total(), [1, 1, 1, 1]);
  assert.equal(store.saves, 0);
});

test('adoção não reivindica empresas por nome', async () => {
  const crm = withPreexisting();
  await loadDemo(crm, memoryStore());
  toLegacy(crm);
  crm.companies.set('lookalike', { name: DEMO_COMPANIES[1].name });
  const store = memoryStore();
  await adoptDemo(crm, store, { confirm: true });
  assert.deepEqual(store.manifest.workspaces['ws-1'].companies, {});
  await assert.rejects(loadDemo(crm, store), /não estão no manifesto/);
});

test('migração do manifesto v1 → v2 só acrescenta companies e preserva o resto', () => {
  const v1 = {
    version: 1,
    workspaces: {
      'ws-1': {
        people: { 'demo-01@example.test': 'p1' },
        opportunities: { '[DEMO] A': 'o1' },
        tasks: { '[DEMO] T': 't1' },
        notes: {},
        adoptedAt: '2026-01-01T00:00:00.000Z',
      },
    },
  };
  const original = structuredClone(v1);
  const v2 = migrateManifest(v1);
  assert.equal(v2.version, 2);
  assert.deepEqual(v2.workspaces['ws-1'], {
    ...original.workspaces['ws-1'],
    companies: {},
  });
  assert.deepEqual(v1, original, 'a entrada não é alterada');
  assert.equal(migrateManifest(v2), v2, 'v2 passa intacto');
  assert.throws(
    () => migrateManifest({ version: 3, workspaces: {} }),
    /versão desconhecida/,
  );
});

test('manifesto v1 existente: a carga cria só as empresas e vincula os 10 sem recriar nada', async () => {
  const crm = withPreexisting();
  const store = memoryStore();
  await loadDemo(crm, store);
  toLegacy(crm, store);
  const idsBefore = structuredClone(store.manifest.workspaces['ws-1']);
  const totalBefore = crm.total();

  const created = await loadDemo(crm, store);
  assert.deepEqual(created, {
    companies: 2,
    people: 0,
    opportunities: 0,
    tasks: 0,
    notes: 0,
  });
  assert.equal(store.manifest.version, 2);
  const after = store.manifest.workspaces['ws-1'];
  for (const kind of ['people', 'opportunities', 'tasks', 'notes']) {
    assert.deepEqual(after[kind], idsBefore[kind], `${kind}: mesmos UUIDs`);
  }
  assert.deepEqual(crm.total(), totalBefore);
  assert.equal(
    (await crm.getCompany(companyId(store, 'IMOVEIS'))).personIds.length,
    5,
  );
  assert.equal(
    (await crm.getCompany(companyId(store, 'VEICULOS'))).opportunityIds.length,
    5,
  );
  assert.equal(crm.people.get('real-person').companyId ?? null, null);
});

test('manifesto v1 com inconsistência: aborta antes de qualquer mutação', async () => {
  const crm = withPreexisting();
  const store = memoryStore();
  await loadDemo(crm, store);
  toLegacy(crm, store);
  const opportunityId =
    store.manifest.workspaces['ws-1'].opportunities[DEMO_DEALS[0].opportunity];
  crm.taskTargets.push({ taskId: 'real-task', opportunityId });
  const manifestBefore = structuredClone(store.manifest);
  const savesBefore = store.saves;

  await assert.rejects(loadDemo(crm, store), /divergem do esperado/);
  assert.equal(crm.companies.size, 0, 'nenhuma empresa criada');
  assert.ok([...crm.people.values()].every((person) => !person.companyId));
  assert.deepEqual(store.manifest, manifestBefore);
  assert.equal(store.saves, savesBefore);
});

test('contato da demo ligado a empresa alheia bloqueia a carga sem alterar nada', async () => {
  const crm = withPreexisting();
  const store = memoryStore();
  await loadDemo(crm, store);
  crm.companies.set('foreign', { name: 'Empresa de outra pessoa' });
  const personId =
    store.manifest.workspaces['ws-1'].people[DEMO_DEALS[0].email];
  crm.people.get(personId).companyId = 'foreign';

  await assert.rejects(loadDemo(crm, store), /vinculado a outra empresa/);
  assert.equal(crm.people.get(personId).companyId, 'foreign');
});

test('carga repara vínculo faltante de empresa sem duplicar nada', async () => {
  const crm = withPreexisting();
  const store = memoryStore();
  await loadDemo(crm, store);
  const personId =
    store.manifest.workspaces['ws-1'].people[DEMO_DEALS[0].email];
  crm.people.get(personId).companyId = null;
  const totalBefore = crm.total();
  const created = await loadDemo(crm, store);
  assert.equal(created.companies + created.people, 0);
  assert.deepEqual(crm.total(), totalBefore);
  assert.equal(crm.people.get(personId).companyId, companyId(store, 'IMOVEIS'));
});

test('limpeza bloqueada: pessoa de fora ligada a uma empresa da demo', async () => {
  const crm = withPreexisting();
  const store = memoryStore();
  await loadDemo(crm, store);
  crm.people.get('real-person').companyId = companyId(store, 'VEICULOS');
  await assert.rejects(
    cleanDemo(crm, store, { confirm: true }),
    /empresa .* diverge do esperado/,
  );
  assert.equal(crm.destroyed.length, 0);
  assert.ok(store.manifest.workspaces['ws-1']);
});

test('limpeza bloqueada: contato da demo na empresa errada', async () => {
  const crm = withPreexisting();
  const store = memoryStore();
  await loadDemo(crm, store);
  const personId =
    store.manifest.workspaces['ws-1'].people[DEMO_DEALS[0].email];
  crm.people.get(personId).companyId = companyId(store, 'VEICULOS');
  await assert.rejects(
    cleanDemo(crm, store, { confirm: true }),
    /empresa diferente do esperado/,
  );
  assert.equal(crm.destroyed.length, 0);
});

test('UUID de empresa ausente no CRM bloqueia a limpeza e preserva o manifesto', async () => {
  const crm = withPreexisting();
  const store = memoryStore();
  await loadDemo(crm, store);
  const manifestBefore = structuredClone(store.manifest);
  crm.companies.delete(companyId(store, 'IMOVEIS'));
  await assert.rejects(
    cleanDemo(crm, store, { confirm: true }),
    /empresa .* ausente no CRM/,
  );
  assert.equal(crm.destroyed.length, 0);
  assert.deepEqual(store.manifest, manifestBefore);
});

test('limpeza válida remove as duas empresas do manifesto e preserva empresas preexistentes', async () => {
  const crm = withPreexisting();
  crm.companies.set('real-company', { name: 'Empresa real' });
  crm.people.get('real-person').companyId = 'real-company';
  const store = memoryStore();
  await loadDemo(crm, store);
  const ownCompanies = Object.values(
    store.manifest.workspaces['ws-1'].companies,
  );
  assert.equal(ownCompanies.length, 2);

  const result = await cleanDemo(crm, store, { confirm: true });
  assert.equal(result.removed, true);
  assert.ok(ownCompanies.every((id) => !crm.companies.has(id)));
  assert.deepEqual([...crm.companies.keys()], ['real-company']);
  assert.equal(crm.people.get('real-person').companyId, 'real-company');
  assert.deepEqual(crm.total(), PRE_TOTAL);
});

test('dry-run da limpeza lista as empresas e não remove nada', async () => {
  const crm = withPreexisting();
  const store = memoryStore();
  await loadDemo(crm, store);
  const result = await cleanDemo(crm, store, { confirm: false });
  assert.equal(result.plan.Company.length, 2);
  assert.equal(crm.destroyed.length, 0);
  assert.equal(crm.companies.size, 2);
});
