// Carrega (ou remove com --clean) uma pequena massa de demonstração fictícia no Jean CRM.
// Execução sempre explícita. Idempotente: a 2ª execução não duplica nada.
// Os dados são identificados por nomes/e-mails EXATOS desta lista; a limpeza só apaga esses.
// Credenciais por variável de ambiente (veja docs/JEAN_DEMO.md).
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

const edges = (data, key) => data[key].edges.map((edge) => edge.node);

const findByNames = async (gql, query, key, field, values) =>
  edges(await gql(query, { values }), key).filter((node) =>
    values.includes(field(node)),
  );

export const runDemo = async ({ clean }) => {
  const token = await getToken();
  const gql = (query, variables) =>
    request('/graphql', query, variables, token);

  const emails = DEMO_DEALS.map((deal) => deal.email);
  const opportunityNames = DEMO_DEALS.map((deal) => deal.opportunity);
  const taskTitles = DEMO_DEALS.map((deal) => deal.task);
  const noteTitles = DEMO_NOTES.map((note) => note.title);

  const load = async () => ({
    people: await findByNames(
      gql,
      `query($values:[String]){people(first:200,filter:{emails:{primaryEmail:{in:$values}}}){edges{node{id emails{primaryEmail}}}}}`,
      'people',
      (node) => node.emails.primaryEmail,
      emails,
    ),
    opportunities: await findByNames(
      gql,
      `query($values:[String]){opportunities(first:200,filter:{name:{in:$values}}){edges{node{id name taskTargets{edges{node{id}}}}}}}`,
      'opportunities',
      (node) => node.name,
      opportunityNames,
    ),
    tasks: await findByNames(
      gql,
      `query($values:[String]){tasks(first:200,filter:{title:{in:$values}}){edges{node{id title taskTargets{edges{node{id targetOpportunityId}}}}}}}`,
      'tasks',
      (node) => node.title,
      taskTitles,
    ),
    notes: await findByNames(
      gql,
      `query($values:[String]){notes(first:200,filter:{title:{in:$values}}){edges{node{id title noteTargets{edges{node{id targetOpportunityId}}}}}}}`,
      'notes',
      (node) => node.title,
      noteTitles,
    ),
  });

  if (clean) {
    const existing = await load();
    // Ordem inversa de dependência. Só ids de registros com nome/e-mail exatos da lista.
    const groups = [
      ['Note', existing.notes],
      ['Task', existing.tasks],
      ['Opportunity', existing.opportunities],
      ['Person', existing.people],
    ];
    for (const [type, nodes] of groups) {
      for (const node of nodes) {
        await gql(`mutation($id:UUID!){destroy${type}(id:$id){id}}`, {
          id: node.id,
        });
      }
      console.log(`demo --clean: ${nodes.length} ${type} removidos.`);
    }
    return;
  }

  const existing = await load();
  const personByEmail = new Map(
    existing.people.map((node) => [node.emails.primaryEmail, node.id]),
  );
  const opportunityByName = new Map(
    existing.opportunities.map((node) => [node.name, node.id]),
  );
  const taskByTitle = new Map(existing.tasks.map((node) => [node.title, node]));
  const noteByTitle = new Map(existing.notes.map((node) => [node.title, node]));
  const created = { people: 0, opportunities: 0, tasks: 0, notes: 0 };

  for (const deal of DEMO_DEALS) {
    if (!personByEmail.has(deal.email)) {
      const result = await gql(
        `mutation($d:PersonCreateInput!){createPerson(data:$d){id}}`,
        {
          d: {
            name: { firstName: deal.firstName, lastName: deal.lastName },
            emails: { primaryEmail: deal.email },
          },
        },
      );
      personByEmail.set(deal.email, result.createPerson.id);
      created.people += 1;
    }
    if (!opportunityByName.has(deal.opportunity)) {
      const result = await gql(
        `mutation($d:OpportunityCreateInput!){createOpportunity(data:$d){id}}`,
        {
          d: {
            name: deal.opportunity,
            pointOfContactId: personByEmail.get(deal.email),
            interesse: deal.interest,
            stage: deal.stage,
          },
        },
      );
      opportunityByName.set(deal.opportunity, result.createOpportunity.id);
      created.opportunities += 1;
    }
    const opportunityId = opportunityByName.get(deal.opportunity);
    let task = taskByTitle.get(deal.task);
    if (!task) {
      const result = await gql(
        `mutation($d:TaskCreateInput!){createTask(data:$d){id}}`,
        {
          d: { title: deal.task, status: 'TODO' },
        },
      );
      task = { id: result.createTask.id, taskTargets: { edges: [] } };
      created.tasks += 1;
    }
    if (task.taskTargets.edges.length === 0) {
      await gql(
        `mutation($d:TaskTargetCreateInput!){createTaskTarget(data:$d){id}}`,
        {
          d: { taskId: task.id, targetOpportunityId: opportunityId },
        },
      );
    }
  }

  for (const note of DEMO_NOTES) {
    let existingNote = noteByTitle.get(note.title);
    if (!existingNote) {
      const result = await gql(
        `mutation($d:NoteCreateInput!){createNote(data:$d){id}}`,
        {
          d: { title: note.title },
        },
      );
      existingNote = { id: result.createNote.id, noteTargets: { edges: [] } };
      created.notes += 1;
    }
    if (existingNote.noteTargets.edges.length === 0) {
      await gql(
        `mutation($d:NoteTargetCreateInput!){createNoteTarget(data:$d){id}}`,
        {
          d: {
            noteId: existingNote.id,
            targetOpportunityId: opportunityByName.get(note.opportunity),
          },
        },
      );
    }
  }

  console.log(
    `demo: criados ${created.people} contatos, ${created.opportunities} oportunidades, ${created.tasks} tarefas, ${created.notes} notas.`,
  );
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

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  (process.argv.includes('--verify')
    ? verifyViews()
    : runDemo({ clean: process.argv.includes('--clean') })
  ).catch((error) => {
    console.error(error.message.slice(0, 800));
    process.exit(1);
  });
}
