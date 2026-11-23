// Carrega a demonstração fictícia do Jean CRM (ou adota/remove com confirmação explícita).
// Execução sempre explícita. Idempotente: a 2ª execução não duplica nada.
// Propriedade dos dados = manifesto local de UUIDs (fora do Git), nunca nome ou e-mail iguais.
// Credenciais por variável de ambiente (veja docs/JEAN_DEMO.md).
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { getToken, request } from './jean-crm-setup.mjs';

const PREFIX = '[DEMO] ';
const EMAIL_DOMAIN = 'example.test';

export const DEMO_DEALS = [
  // Jean Imóveis
  [
    'IMOVEIS',
    'Interesse em apartamento',
    'NEW',
    'Ana',
    'Teste Imóveis',
    'Ligar para entender o perfil do imóvel',
  ],
  [
    'IMOVEIS',
    'Interesse em casa',
    'CONTACTED',
    'Bruno',
    'Teste Imóveis',
    'Retornar contato com opções de casas',
  ],
  [
    'IMOVEIS',
    'Venda de imóvel residencial',
    'QUALIFIED',
    'Carla',
    'Teste Imóveis',
    'Agendar visita ao imóvel',
  ],
  [
    'IMOVEIS',
    'Busca por terreno',
    'NEGOTIATION',
    'Diego',
    'Teste Imóveis',
    'Enviar proposta ao cliente',
  ],
  [
    'IMOVEIS',
    'Atendimento imobiliário inicial',
    'WON',
    'Elisa',
    'Teste Imóveis',
    'Registrar pós-venda',
  ],
  // Jean Veículos
  [
    'VEICULOS',
    'Interesse em SUV',
    'NEW',
    'Fábio',
    'Teste Veículos',
    'Ligar para entender o uso do veículo',
  ],
  [
    'VEICULOS',
    'Compra de carro usado',
    'CONTACTED',
    'Gisele',
    'Teste Veículos',
    'Retornar contato com opções de carros usados',
  ],
  [
    'VEICULOS',
    'Venda de veículo',
    'QUALIFIED',
    'Hugo',
    'Teste Veículos',
    'Agendar avaliação do veículo',
  ],
  [
    'VEICULOS',
    'Troca de automóvel',
    'NEGOTIATION',
    'Irene',
    'Teste Veículos',
    'Enviar proposta de troca',
  ],
  [
    'VEICULOS',
    'Interesse em veículo econômico',
    'LOST',
    'João',
    'Teste Veículos',
    'Registrar motivo da perda',
  ],
].map(([interest, label, stage, firstName, lastName, taskText], index) => ({
  interest,
  stage,
  firstName: `${PREFIX}${firstName}`,
  lastName,
  email: `demo-${String(index + 1).padStart(2, '0')}@${EMAIL_DOMAIN}`,
  opportunity: `${PREFIX}${label}`,
  task: `${PREFIX}${taskText}`,
}));

// Uma observação em cada operação, para mostrar Notas funcionando.
export const DEMO_NOTES = [
  {
    opportunity: DEMO_DEALS[2].opportunity,
    title: `${PREFIX}Cliente prefere visitas aos sábados`,
  },
  {
    opportunity: DEMO_DEALS[7].opportunity,
    title: `${PREFIX}Cliente quer avaliar o veículo antes`,
  },
];

// ---------------------------------------------------------------------------
// Propriedade dos dados: só é "da demo" o que está no manifesto local (UUIDs).
// Nome/e-mail iguais NÃO provam propriedade. O manifesto fica FORA do Git.
// ---------------------------------------------------------------------------
const emptyEntry = () => ({
  people: {},
  opportunities: {},
  tasks: {},
  notes: {},
});

export const manifestPath = () =>
  process.env.JEAN_DEMO_MANIFEST ??
  join(homedir(), '.jean-crm', 'demo-manifest.json');

export const createFileStore = (path = manifestPath()) => ({
  path,
  load: async () => {
    try {
      return JSON.parse(await readFile(path, 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') return { version: 1, workspaces: {} };
      throw new Error(`Manifesto ilegível (${path}): ${error.message}`);
    }
  },
  save: async (manifest) => {
    await mkdir(dirname(path), { recursive: true });
    const temporary = `${path}.tmp`;
    await writeFile(temporary, JSON.stringify(manifest, null, 2));
    await rename(temporary, path);
  },
});

const KINDS = [
  // [chave no manifesto, lista exata de identificadores, método de busca por nome]
  ['people', DEMO_DEALS.map((deal) => deal.email), 'listPeopleByEmails'],
  [
    'opportunities',
    DEMO_DEALS.map((deal) => deal.opportunity),
    'listOpportunitiesByNames',
  ],
  ['tasks', DEMO_DEALS.map((deal) => deal.task), 'listTasksByTitles'],
  ['notes', DEMO_NOTES.map((note) => note.title), 'listNotesByTitles'],
];

const sameSet = (left, right) =>
  left.length === right.length && left.every((value) => right.includes(value));

// Registros com identificador da demo que NÃO pertencem ao manifesto (conflito/duplicidade).
const findUnmanaged = async (crm, entry) => {
  const unmanaged = [];
  for (const [kind, identifiers, finder] of KINDS) {
    for (const node of await crm[finder](identifiers)) {
      if (entry[kind][node.key] !== node.id)
        unmanaged.push(`${kind}:${node.key} (${node.id})`);
    }
  }
  return unmanaged;
};

// Confere que cada id do manifesto ainda é exatamente o registro esperado, com as relações
// esperadas. Devolve problemas e os ids existentes (ids já removidos são ignorados).
const inspectOwned = async (crm, entry) => {
  const problems = [];
  const existing = { notes: [], tasks: [], opportunities: [], people: [] };

  for (const deal of DEMO_DEALS) {
    const id = entry.people[deal.email];
    if (!id) continue;
    const person = await crm.getPerson(id);
    if (!person) continue;
    if (person.email !== deal.email || person.firstName !== deal.firstName) {
      problems.push(`pessoa ${id} diverge do esperado (${deal.email})`);
    }
    existing.people.push(id);
  }

  for (const deal of DEMO_DEALS) {
    const id = entry.opportunities[deal.opportunity];
    if (!id) continue;
    const opportunity = await crm.getOpportunity(id);
    if (!opportunity) continue;
    const expectedTask = entry.tasks[deal.task];
    const expectedNotes = DEMO_NOTES.filter(
      (note) => note.opportunity === deal.opportunity,
    )
      .map((note) => entry.notes[note.title])
      .filter(Boolean);
    if (
      opportunity.name !== deal.opportunity ||
      opportunity.interest !== deal.interest
    ) {
      problems.push(
        `oportunidade ${id} diverge do esperado (${deal.opportunity})`,
      );
    }
    if (opportunity.pointOfContactId !== entry.people[deal.email]) {
      problems.push(`oportunidade ${id}: contato diferente do esperado`);
    }
    if (!sameSet(opportunity.taskIds, expectedTask ? [expectedTask] : [])) {
      problems.push(
        `oportunidade ${id}: tarefas vinculadas diferentes do esperado`,
      );
    }
    if (!sameSet(opportunity.noteIds, expectedNotes)) {
      problems.push(
        `oportunidade ${id}: notas vinculadas diferentes do esperado`,
      );
    }
    existing.opportunities.push(id);
  }

  for (const deal of DEMO_DEALS) {
    const id = entry.tasks[deal.task];
    if (!id) continue;
    const task = await crm.getTask(id);
    if (!task) continue;
    const opportunityId = entry.opportunities[deal.opportunity];
    if (
      task.title !== deal.task ||
      !sameSet(task.opportunityIds, opportunityId ? [opportunityId] : [])
    ) {
      problems.push(`tarefa ${id} diverge do esperado (${deal.task})`);
    }
    existing.tasks.push(id);
  }

  for (const note of DEMO_NOTES) {
    const id = entry.notes[note.title];
    if (!id) continue;
    const found = await crm.getNote(id);
    if (!found) continue;
    const opportunityId = entry.opportunities[note.opportunity];
    if (
      found.title !== note.title ||
      !sameSet(found.opportunityIds, opportunityId ? [opportunityId] : [])
    ) {
      problems.push(`nota ${id} diverge do esperado (${note.title})`);
    }
    existing.notes.push(id);
  }

  problems.push(
    ...(await findUnmanaged(crm, entry)).map(
      (item) => `duplicidade/conflito: ${item}`,
    ),
  );
  return { problems, existing };
};

const abortWith = (title, problems) => {
  throw new Error(`${title}\n - ${problems.slice(0, 15).join('\n - ')}`);
};

const readEntry = async (crm, store) => {
  const workspaceId = await crm.workspaceId();
  const manifest = await store.load();
  return { workspaceId, manifest, entry: manifest.workspaces[workspaceId] };
};

// Carga idempotente. Só reutiliza registros do manifesto; registro preexistente com o mesmo
// nome/e-mail bloqueia a carga (nada é criado) em vez de ser assumido como demo.
export const loadDemo = async (crm, store) => {
  const {
    workspaceId,
    manifest,
    entry: existingEntry,
  } = await readEntry(crm, store);
  const entry = existingEntry ?? emptyEntry();

  const unmanaged = await findUnmanaged(crm, entry);
  if (unmanaged.length > 0) {
    abortWith(
      'Carga abortada: já existem registros com identificadores da demo que não estão no manifesto. ' +
        'Nada foi criado. Se forem mesmo da demo, use --adopt (dry-run) e --adopt --confirm.',
      unmanaged,
    );
  }

  manifest.workspaces[workspaceId] = entry;
  const remember = async (kind, key, id) => {
    entry[kind][key] = id;
    entry.updatedAt = new Date().toISOString();
    await store.save(manifest); // grava a cada criação: uma falha no meio não perde ids
  };
  const created = { people: 0, opportunities: 0, tasks: 0, notes: 0 };

  for (const deal of DEMO_DEALS) {
    if (
      !(
        entry.people[deal.email] &&
        (await crm.getPerson(entry.people[deal.email]))
      )
    ) {
      await remember('people', deal.email, await crm.createPerson(deal));
      created.people += 1;
    }
    if (
      !(
        entry.opportunities[deal.opportunity] &&
        (await crm.getOpportunity(entry.opportunities[deal.opportunity]))
      )
    ) {
      await remember(
        'opportunities',
        deal.opportunity,
        await crm.createOpportunity(deal, entry.people[deal.email]),
      );
      created.opportunities += 1;
    }
    const opportunityId = entry.opportunities[deal.opportunity];
    let task =
      entry.tasks[deal.task] && (await crm.getTask(entry.tasks[deal.task]));
    if (!task) {
      await remember('tasks', deal.task, await crm.createTask(deal.task));
      task = { opportunityIds: [] };
      created.tasks += 1;
    }
    if (!task.opportunityIds.includes(opportunityId)) {
      await crm.createTaskTarget(entry.tasks[deal.task], opportunityId);
    }
  }

  for (const note of DEMO_NOTES) {
    let found =
      entry.notes[note.title] && (await crm.getNote(entry.notes[note.title]));
    if (!found) {
      await remember('notes', note.title, await crm.createNote(note.title));
      found = { opportunityIds: [] };
      created.notes += 1;
    }
    const opportunityId = entry.opportunities[note.opportunity];
    if (!found.opportunityIds.includes(opportunityId)) {
      await crm.createNoteTarget(entry.notes[note.title], opportunityId);
    }
  }
  return created;
};

// Adota mocks já existentes (criados antes do manifesto). Exige correspondência única e
// relações exatamente iguais às da demo; sem --confirm só mostra o que adotaria.
export const adoptDemo = async (crm, store, { confirm }) => {
  const {
    workspaceId,
    manifest,
    entry: existingEntry,
  } = await readEntry(crm, store);
  if (existingEntry)
    throw new Error('Este workspace já tem manifesto; nada a adotar.');
  const entry = emptyEntry();
  const problems = [];
  for (const [kind, identifiers, finder] of KINDS) {
    const found = await crm[finder](identifiers);
    for (const node of found) {
      if (entry[kind][node.key])
        problems.push(`duplicidade: ${kind}:${node.key}`);
      entry[kind][node.key] = node.id;
    }
  }
  const inspected = await inspectOwned(crm, entry);
  problems.push(
    ...inspected.problems.filter(
      (problem) => !problem.startsWith('duplicidade/conflito'),
    ),
  );
  if (problems.length > 0)
    abortWith('Adoção abortada, nada foi gravado.', problems);

  const total = Object.values(entry).reduce(
    (sum, map) => sum + Object.keys(map).length,
    0,
  );
  if (!confirm) return { adopted: false, total };
  entry.adoptedAt = new Date().toISOString();
  manifest.workspaces[workspaceId] = entry;
  await store.save(manifest);
  return { adopted: true, total };
};

// Limpeza: só por UUIDs do manifesto, no workspace do manifesto, após verificar tudo.
// Sem --confirm é um dry-run que apenas lista o que seria removido.
export const cleanDemo = async (crm, store, { confirm }) => {
  const { workspaceId, manifest, entry } = await readEntry(crm, store);
  if (!entry) {
    throw new Error(
      'Limpeza bloqueada: não há manifesto para este workspace. Nada foi removido.',
    );
  }
  const { problems, existing } = await inspectOwned(crm, entry);
  if (problems.length > 0)
    abortWith('Limpeza bloqueada, nada foi removido.', problems);

  const plan = {
    Note: existing.notes,
    Task: existing.tasks,
    Opportunity: existing.opportunities,
    Person: existing.people,
  };
  if (!confirm) return { removed: false, plan };
  for (const [type, ids] of Object.entries(plan)) {
    for (const id of ids) await crm.destroy(type, id);
  }
  delete manifest.workspaces[workspaceId];
  await store.save(manifest);
  return { removed: true, plan };
};

// ---------------------------------------------------------------------------
// Adaptador real (GraphQL do Twenty). Os testes usam um fake em memória.
// ---------------------------------------------------------------------------
export const createGraphqlCrm = async () => {
  const token = await getToken();
  const gql = (query, variables) =>
    request('/graphql', query, variables, token);
  const meta = (query, variables) =>
    request('/metadata', query, variables, token);
  const nodes = (data, key) => data[key].edges.map((edge) => edge.node);
  const ids = (connection, field) =>
    connection.edges.map((edge) => edge.node[field]);

  return {
    workspaceId: async () =>
      (await meta(`{currentWorkspace{id}}`)).currentWorkspace.id,

    listPeopleByEmails: async (values) =>
      nodes(
        await gql(
          `query($v:[String]){people(first:200,filter:{emails:{primaryEmail:{in:$v}}}){edges{node{id emails{primaryEmail}}}}}`,
          { v: values },
        ),
        'people',
      )
        .map((node) => ({ id: node.id, key: node.emails.primaryEmail }))
        .filter((node) => values.includes(node.key)),
    listOpportunitiesByNames: async (values) =>
      nodes(
        await gql(
          `query($v:[String]){opportunities(first:200,filter:{name:{in:$v}}){edges{node{id name}}}}`,
          { v: values },
        ),
        'opportunities',
      )
        .map((node) => ({ id: node.id, key: node.name }))
        .filter((node) => values.includes(node.key)),
    listTasksByTitles: async (values) =>
      nodes(
        await gql(
          `query($v:[String]){tasks(first:200,filter:{title:{in:$v}}){edges{node{id title}}}}`,
          { v: values },
        ),
        'tasks',
      )
        .map((node) => ({ id: node.id, key: node.title }))
        .filter((node) => values.includes(node.key)),
    listNotesByTitles: async (values) =>
      nodes(
        await gql(
          `query($v:[String]){notes(first:200,filter:{title:{in:$v}}){edges{node{id title}}}}`,
          { v: values },
        ),
        'notes',
      )
        .map((node) => ({ id: node.id, key: node.title }))
        .filter((node) => values.includes(node.key)),

    getPerson: async (id) => {
      const data = await gql(
        `query($id:UUID!){person(filter:{id:{eq:$id}}){id name{firstName} emails{primaryEmail}}}`,
        { id },
      );
      const node = data.person;
      return node
        ? {
            id,
            firstName: node.name.firstName,
            email: node.emails.primaryEmail,
          }
        : null;
    },
    getOpportunity: async (id) => {
      const data = await gql(
        `query($id:UUID!){opportunity(filter:{id:{eq:$id}}){id name interesse pointOfContact{id} taskTargets{edges{node{taskId}}} noteTargets{edges{node{noteId}}}}}`,
        { id },
      );
      const node = data.opportunity;
      return node
        ? {
            id,
            name: node.name,
            interest: node.interesse,
            pointOfContactId: node.pointOfContact?.id ?? null,
            taskIds: ids(node.taskTargets, 'taskId'),
            noteIds: ids(node.noteTargets, 'noteId'),
          }
        : null;
    },
    getTask: async (id) => {
      const data = await gql(
        `query($id:UUID!){task(filter:{id:{eq:$id}}){id title taskTargets{edges{node{targetOpportunityId}}}}}`,
        { id },
      );
      const node = data.task;
      return node
        ? {
            id,
            title: node.title,
            opportunityIds: ids(node.taskTargets, 'targetOpportunityId'),
          }
        : null;
    },
    getNote: async (id) => {
      const data = await gql(
        `query($id:UUID!){note(filter:{id:{eq:$id}}){id title noteTargets{edges{node{targetOpportunityId}}}}}`,
        { id },
      );
      const node = data.note;
      return node
        ? {
            id,
            title: node.title,
            opportunityIds: ids(node.noteTargets, 'targetOpportunityId'),
          }
        : null;
    },

    createPerson: async (deal) =>
      (
        await gql(
          `mutation($d:PersonCreateInput!){createPerson(data:$d){id}}`,
          {
            d: {
              name: { firstName: deal.firstName, lastName: deal.lastName },
              emails: { primaryEmail: deal.email },
            },
          },
        )
      ).createPerson.id,
    createOpportunity: async (deal, pointOfContactId) =>
      (
        await gql(
          `mutation($d:OpportunityCreateInput!){createOpportunity(data:$d){id}}`,
          {
            d: {
              name: deal.opportunity,
              pointOfContactId,
              interesse: deal.interest,
              stage: deal.stage,
            },
          },
        )
      ).createOpportunity.id,
    createTask: async (title) =>
      (
        await gql(`mutation($d:TaskCreateInput!){createTask(data:$d){id}}`, {
          d: { title, status: 'TODO' },
        })
      ).createTask.id,
    createTaskTarget: (taskId, opportunityId) =>
      gql(
        `mutation($d:TaskTargetCreateInput!){createTaskTarget(data:$d){id}}`,
        {
          d: { taskId, targetOpportunityId: opportunityId },
        },
      ),
    createNote: async (title) =>
      (
        await gql(`mutation($d:NoteCreateInput!){createNote(data:$d){id}}`, {
          d: { title },
        })
      ).createNote.id,
    createNoteTarget: (noteId, opportunityId) =>
      gql(
        `mutation($d:NoteTargetCreateInput!){createNoteTarget(data:$d){id}}`,
        {
          d: { noteId, targetOpportunityId: opportunityId },
        },
      ),
    destroy: (type, id) =>
      gql(`mutation($id:UUID!){destroy${type}(id:$id){id}}`, { id }),
  };
};

// Confere via API que cada view filtrada mostra só o interesse correspondente.
// Usa o filtro realmente gravado na view (não um valor fixo no script).
export const verifyViews = async () => {
  const token = await getToken();
  const meta = (query, variables) =>
    request('/metadata', query, variables, token);
  const gql = (query, variables) =>
    request('/graphql', query, variables, token);
  const { objects } = await meta(
    `{objects(paging:{first:200}){edges{node{id nameSingular}}}}`,
  );
  const opportunity = objects.edges
    .map((edge) => edge.node)
    .find((node) => node.nameSingular === 'opportunity');
  const { getViews: views } = await meta(
    `query($id:String){getViews(objectMetadataId:$id){name viewFilters{operand value}}}`,
    { id: opportunity.id },
  );
  const checks = [
    ['Imóveis', 'IMOVEIS', 'VEICULOS'],
    ['Veículos', 'VEICULOS', 'IMOVEIS'],
  ];
  for (const [viewName, interest, other] of checks) {
    const view = views.find((candidate) => candidate.name === viewName);
    if (!view || view.viewFilters.length !== 1)
      throw new Error(`FALHOU: view ${viewName} sem filtro único.`);
    const [filter] = view.viewFilters;
    const values = JSON.parse(filter.value);
    if (
      filter.operand !== 'IS' ||
      values.length !== 1 ||
      values[0] !== interest
    ) {
      throw new Error(
        `FALHOU: filtro de ${viewName} inesperado: ${filter.operand} ${filter.value}`,
      );
    }
    const data = await gql(
      `query($values:[OpportunityInterestEnum]){opportunities(first:200,filter:{interesse:{in:$values}}){edges{node{name interesse}}}}`,
      { values },
    );
    const nodes = data.opportunities.edges.map((edge) => edge.node);
    const demo = nodes.filter((node) => node.name.startsWith(PREFIX));
    const wanted = DEMO_DEALS.filter((deal) => deal.interest === interest).map(
      (deal) => deal.opportunity,
    );
    const leaked = DEMO_DEALS.filter((deal) => deal.interest === other).map(
      (deal) => deal.opportunity,
    );
    if (nodes.some((node) => node.interesse !== interest))
      throw new Error(`FALHOU: ${viewName} traz outro interesse.`);
    if (!wanted.every((name) => demo.some((node) => node.name === name)))
      throw new Error(`FALHOU: ${viewName} não traz os 5 de demo.`);
    if (demo.some((node) => leaked.includes(node.name)))
      throw new Error(`FALHOU: ${viewName} vazou o outro interesse.`);
    console.log(
      `ok: view ${viewName}: ${nodes.length} oportunidades, todas ${interest}; ${demo.length} de demo; nenhuma de ${other}.`,
    );
  }
};

const summarize = (plan) =>
  Object.entries(plan)
    .map(([type, ids]) => `${ids.length} ${type}`)
    .join(', ');

const run = async () => {
  const args = new Set(process.argv.slice(2));
  if (args.has('--verify')) return verifyViews();
  const crm = await createGraphqlCrm();
  const store = createFileStore();
  const confirm = args.has('--confirm');

  if (args.has('--clean')) {
    const result = await cleanDemo(crm, store, { confirm });
    console.log(
      `demo --clean: ${result.removed ? 'removidos' : 'seriam removidos (dry-run, use --clean --confirm)'}: ${summarize(result.plan)}.`,
    );
  } else if (args.has('--adopt')) {
    const result = await adoptDemo(crm, store, { confirm });
    console.log(
      result.adopted
        ? `demo --adopt: ${result.total} registros adotados no manifesto (${store.path}).`
        : `demo --adopt (dry-run): ${result.total} registros seriam adotados; use --adopt --confirm.`,
    );
  } else {
    const created = await loadDemo(crm, store);
    console.log(
      `demo: criados ${created.people} contatos, ${created.opportunities} oportunidades, ${created.tasks} tarefas, ${created.notes} notas.`,
    );
  }
};

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((error) => {
    console.error(error.message.slice(0, 1500));
    process.exit(1);
  });
}
