// Cria a view Kanban nativa "Kanban de Tarefas" (agrupada por status) pela API do Twenty. Idempotente.
// Uso: veja docs/JEAN_TASKS_KANBAN.md. Credenciais só por variáveis de ambiente.
import { pathToFileURL } from 'node:url';
import { getToken, request } from './jean-crm-setup.mjs';

export const KANBAN_NAME = 'Kanban de Tarefas';
export const STATUS_LABELS = [
  { value: 'TODO', label: 'A fazer' },
  { value: 'IN_PROGRESS', label: 'Em andamento' },
  { value: 'DONE', label: 'Concluídas' },
];
// Campos do cartão: título, prazo e responsável.
export const CARD_FIELDS = ['title', 'dueAt', 'assignee'];

// Só troca rótulos (valores, ids, cores e posições ficam). Aborta se as opções não forem as 3 do Twenty.
export const planStatusLabels = (options) => {
  const wanted = STATUS_LABELS.map((item) => item.value);
  const current = options.map((option) => option.value);
  const isExpected =
    current.length === wanted.length &&
    new Set(current).size === wanted.length &&
    wanted.every((value) => current.includes(value));
  if (!isExpected) {
    return {
      action: 'abort',
      reason: `status tem opções inesperadas (${current.join(', ')}). Abortando para não sobrescrever.`,
    };
  }
  const updated = options.map((option) => ({
    ...option,
    label: STATUS_LABELS.find((item) => item.value === option.value).label,
  }));
  const changed = updated.some(
    (option, index) => option.label !== options[index].label,
  );
  return changed ? { action: 'update', options: updated } : { action: 'skip' };
};

// Decide o que fazer com as views da Task, sem tocar na API. Nunca altera uma view existente.
export const planKanbanView = (views, statusFieldId, cardFieldIds = {}) => {
  const abort = (reason) => ({ action: 'abort', reason });
  const matches = views.filter((view) => view.name === KANBAN_NAME);
  if (matches.length === 0) return { action: 'create' };
  if (matches.length > 1) {
    return abort(
      `Há ${matches.length} views "${KANBAN_NAME}". Abortando sem alterar.`,
    );
  }
  const [view] = matches;
  const groups = [...(view.viewGroups ?? [])]
    .filter((group) => group.fieldValue !== '') // coluna nativa "sem valor"
    .sort((a, b) => a.position - b.position)
    .map((group) => `${group.fieldValue}:${group.isVisible}`);
  const wantedGroups = STATUS_LABELS.map((item) => `${item.value}:true`);
  const problems = [];
  if (view.type !== 'KANBAN') problems.push('tipo diferente de KANBAN');
  if (view.mainGroupByFieldMetadataId !== statusFieldId) {
    problems.push('não agrupa por status');
  }
  if (JSON.stringify(groups) !== JSON.stringify(wantedGroups)) {
    problems.push(`colunas diferentes (${groups.join(', ') || 'nenhuma'})`);
  }
  // Campos do cartão: cada um presente uma única vez e visível.
  for (const [name, fieldId] of Object.entries(cardFieldIds)) {
    const entries = (view.viewFields ?? []).filter(
      (viewField) => viewField.fieldMetadataId === fieldId,
    );
    if (entries.length === 0) problems.push(`campo ${name} ausente no cartão`);
    else if (entries.length > 1) {
      problems.push(`campo ${name} duplicado no cartão`);
    } else if (!entries[0].isVisible) {
      problems.push(`campo ${name} oculto no cartão`);
    }
  }
  return problems.length === 0
    ? { action: 'skip', view }
    : abort(
        `A view "${KANBAN_NAME}" já existe, mas não está como esperado: ${problems.join('; ')}. Abortando sem alterar.`,
      );
};

const loadTask = async (token) => {
  const data = await request(
    '/metadata',
    `{ objects(paging:{first:200}) { edges { node { id nameSingular } } } }`,
    {},
    token,
  );
  const task = data.objects.edges.find(
    (edge) => edge.node.nameSingular === 'task',
  )?.node;
  if (!task) throw new Error('Objeto task não encontrado.');
  const fields = await request(
    '/metadata',
    `query($id:UUID!){ fields(paging:{first:200}, filter:{objectMetadataId:{eq:$id}}) { edges { node { id name options } } } }`,
    { id: task.id },
    token,
  );
  const byName = Object.fromEntries(
    fields.fields.edges.map(({ node }) => [node.name, node]),
  );
  for (const name of ['id', 'status', ...CARD_FIELDS]) {
    if (!byName[name]) throw new Error(`Campo task.${name} não encontrado.`);
  }
  return { objectId: task.id, fields: byName };
};

export const main = async () => {
  const token = await getToken();
  const meta = (query, variables) =>
    request('/metadata', query, variables, token);
  const task = await loadTask(token);
  const status = task.fields.status;

  const labels = planStatusLabels(status.options);
  if (labels.action === 'abort') throw new Error(labels.reason);

  const { getViews: views } = await meta(
    `query($id:String){getViews(objectMetadataId:$id){id name type mainGroupByFieldMetadataId viewGroups{fieldValue isVisible position} viewFields{fieldMetadataId isVisible}}}`,
    { id: task.objectId },
  );
  const view = planKanbanView(
    views,
    status.id,
    Object.fromEntries(CARD_FIELDS.map((name) => [name, task.fields[name].id])),
  );
  if (view.action === 'abort') throw new Error(view.reason);

  // Nada é alterado antes de as duas validações passarem.
  if (labels.action === 'update') {
    await meta(
      `mutation($input:UpdateOneFieldMetadataInput!){updateOneField(input:$input){id}}`,
      { input: { id: status.id, update: { options: labels.options } } },
    );
    console.log('status: rótulos em português (valores inalterados).');
  } else {
    console.log('status: rótulos já corretos.');
  }

  if (view.action === 'skip') {
    console.log(`view "${KANBAN_NAME}" já existe (${view.view.id}).`);
    return;
  }
  const created = await meta(
    `mutation($input:CreateViewInput!){createView(input:$input){id}}`,
    {
      input: {
        name: KANBAN_NAME,
        objectMetadataId: task.objectId,
        type: 'KANBAN',
        icon: 'IconLayoutKanban',
        position: 1,
        visibility: 'WORKSPACE',
        mainGroupByFieldMetadataId: status.id,
        kanbanAggregateOperation: 'COUNT',
        kanbanAggregateOperationFieldMetadataId: task.fields.id.id,
      },
    },
  );
  const viewId = created.createView.id;
  // As colunas (uma por opção de status, mais "sem valor") são criadas pelo próprio Twenty.
  await meta(
    `mutation($inputs:[CreateViewFieldInput!]!){createManyViewFields(inputs:$inputs){id}}`,
    {
      inputs: CARD_FIELDS.map((name, position) => ({
        viewId,
        fieldMetadataId: task.fields[name].id,
        position,
        isVisible: true,
        size: 150,
      })),
    },
  );
  console.log(`view "${KANBAN_NAME}" criada (${viewId}).`);
};

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
