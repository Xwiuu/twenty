// Configura o CRM do Jean pela API de metadata do Twenty. Idempotente: pode rodar várias vezes.
// Uso: veja docs/JEAN_CRM.md. Credenciais só por variáveis de ambiente.
import { pathToFileURL } from 'node:url';

const API_URL = process.env.TWENTY_API_URL ?? 'http://localhost:3000';
const ORIGIN = process.env.TWENTY_ORIGIN ?? 'http://localhost:3001';

const WORKSPACE_NAME = 'Jean CRM';
const NAVIGATION_ORDER = ['person', 'company', 'opportunity', 'task', 'note'];
const INTEREST_VIEWS = [
  { name: 'Imóveis', value: 'IMOVEIS', icon: 'IconHome' },
  { name: 'Veículos', value: 'VEICULOS', icon: 'IconCar' },
];

// Colunas comerciais por tabela. Só configura visibilidade/posição na view; campos e dados não mudam.
const COLUMN_LAYOUTS = [
  {
    object: 'person',
    columns: ['name', 'emails', 'phones', 'company'],
    select: (view) => view.key === 'INDEX',
  },
  {
    object: 'company',
    columns: ['name', 'people', 'opportunities'],
    select: (view) => view.key === 'INDEX',
  },
  {
    object: 'opportunity',
    columns: ['name', 'interesse', 'stage', 'pointOfContact', 'company'],
    select: (view) =>
      view.key === 'INDEX' ||
      INTEREST_VIEWS.some((item) => item.name === view.name),
  },
];

const STAGES = [
  { value: 'NEW', label: 'Novo', color: 'red', legacyValue: 'NEW' },
  {
    value: 'CONTACTED',
    label: 'Contatado',
    color: 'purple',
    legacyValue: 'SCREENING',
  },
  {
    value: 'QUALIFIED',
    label: 'Qualificado',
    color: 'sky',
    legacyValue: 'MEETING',
  },
  {
    value: 'NEGOTIATION',
    label: 'Negociação',
    color: 'turquoise',
    legacyValue: 'PROPOSAL',
  },
  { value: 'WON', label: 'Ganho', color: 'green', legacyValue: 'CUSTOMER' },
  { value: 'LOST', label: 'Perdido', color: 'gray', legacyValue: null },
];

const INTEREST_FIELD = {
  name: 'interesse',
  label: 'Interesse',
  type: 'SELECT',
  icon: 'IconHome',
  isNullable: true,
  options: [
    { value: 'IMOVEIS', label: 'Imóveis', color: 'blue', position: 0 },
    { value: 'VEICULOS', label: 'Veículos', color: 'orange', position: 1 },
  ],
};

export const request = async (path, query, variables, token) => {
  const response = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: ORIGIN,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ query, variables }),
  });
  const body = await response.json();
  if (body.errors) throw new Error(JSON.stringify(body.errors));
  return body.data;
};

export const getToken = async () => {
  if (process.env.TWENTY_API_KEY) return process.env.TWENTY_API_KEY;
  const { JEAN_CRM_EMAIL: email, JEAN_CRM_PASSWORD: password } = process.env;
  if (!email || !password) {
    throw new Error(
      'Defina TWENTY_API_KEY ou JEAN_CRM_EMAIL e JEAN_CRM_PASSWORD.',
    );
  }
  const login = await request(
    '/metadata',
    `mutation($email:String!,$password:String!,$origin:String!){
      getLoginTokenFromCredentials(email:$email,password:$password,origin:$origin){loginToken{token}}}`,
    { email, password, origin: ORIGIN },
  );
  const auth = await request(
    '/metadata',
    `mutation($loginToken:String!,$origin:String!){
      getAuthTokensFromLoginToken(loginToken:$loginToken,origin:$origin){
        tokens{accessOrWorkspaceAgnosticToken{token}}}}`,
    {
      loginToken: login.getLoginTokenFromCredentials.loginToken.token,
      origin: ORIGIN,
    },
  );
  return auth.getAuthTokensFromLoginToken.tokens.accessOrWorkspaceAgnosticToken
    .token;
};

const sameValues = (options, values) =>
  options.length === values.length &&
  [...options]
    .sort((a, b) => a.position - b.position)
    .every((option, index) => option.value === values[index]);

// Decide o que fazer com as opções atuais de `stage`, sem tocar na API.
// Só migra se as opções forem exatamente as 5 padrão do Twenty (sem extras, faltas ou duplicadas).
export const planStageUpdate = (options) => {
  const current = options.map((option) => option.value);
  const wanted = STAGES.map((item) => item.value);
  if (sameValues(options, wanted)) return { action: 'skip' };

  const legacy = STAGES.filter((item) => item.legacyValue).map(
    (item) => item.legacyValue,
  );
  const isStock =
    current.length === legacy.length &&
    new Set(current).size === legacy.length &&
    legacy.every((value) => current.includes(value));
  if (!isStock) {
    return {
      action: 'abort',
      reason: `stage tem opções inesperadas (${current.join(', ')}). Abortando para não sobrescrever.`,
    };
  }

  // Preserva o id de cada opção existente para o Twenty migrar os dados.
  const migrated = STAGES.map((item, position) => {
    const existing = options.find(
      (option) => option.value === item.legacyValue,
    );
    return {
      ...(existing ? { id: existing.id } : {}),
      value: item.value,
      label: item.label,
      color: item.color,
      position,
    };
  });
  return { action: 'update', options: migrated };
};

// Mantém só Pessoas, Empresas, Oportunidades, Tarefas e Notas (nessa ordem) na navegação do workspace.
// Só mexe em itens de workspace (userWorkspaceId nulo); objetos e dados não são afetados.
export const planNavigation = (items, objectNameById) => {
  const workspaceItems = items.filter((item) => !item.userWorkspaceId);
  // Cada item obrigatório precisa existir exatamente uma vez, no nível do workspace,
  // como OBJECT e fora de pasta. Senão aborta antes de planejar qualquer remoção.
  const invalid = [];
  // Só Empresas pode estar ausente (workspaces da Sprint 02 tinham 4 itens): nesse caso o item é
  // criado. Se existir de qualquer forma (em pasta, duplicado), continua abortando.
  const create = [];
  const kept = NAVIGATION_ORDER.map((name, position) => {
    const valid = workspaceItems.filter(
      (item) =>
        item.type === 'OBJECT' &&
        !item.folderId &&
        objectNameById[item.targetObjectMetadataId] === name,
    );
    const anyTarget = workspaceItems.filter(
      (item) => objectNameById[item.targetObjectMetadataId] === name,
    );
    if (name === 'company' && anyTarget.length === 0) {
      create.push({ name, position });
      return undefined;
    }
    if (valid.length !== 1)
      invalid.push(`${name} (${valid.length} encontrados)`);
    return valid[0];
  });
  if (invalid.length > 0) {
    return {
      abort: `navegação: itens obrigatórios ausentes ou duplicados: ${invalid.join(', ')}. Abortando sem alterar o menu.`,
    };
  }
  const keptIds = new Set(kept.filter(Boolean).map((item) => item.id));
  // Itens dentro de pastas primeiro, para a pasta ser removida por último.
  const remove = workspaceItems
    .filter((item) => !keptIds.has(item.id))
    .sort((a, b) => Number(Boolean(b.folderId)) - Number(Boolean(a.folderId)))
    .map((item) => item.id);
  const moves = kept
    .map((item, position) => ({ item, position }))
    .filter(({ item, position }) => item && item.position !== position)
    .map(({ item, position }) => ({ id: item.id, position }));
  return { remove, moves, create };
};

// Decide o que ajustar nas colunas de uma view: mostra e ordena as desejadas, oculta as demais
// (sem apagar nada) e cria a coluna se ainda não existir na view.
export const planColumns = (viewFields, wanted, fieldIdByName) => {
  const nameById = Object.fromEntries(
    Object.entries(fieldIdByName).map(([name, id]) => [id, name]),
  );
  const updates = [];
  const present = new Set();
  for (const viewField of viewFields) {
    const name = nameById[viewField.fieldMetadataId];
    present.add(name);
    const index = wanted.indexOf(name);
    const isVisible = index >= 0;
    const position = isVisible ? index : viewField.position;
    if (viewField.isVisible !== isVisible || viewField.position !== position) {
      updates.push({ id: viewField.id, update: { isVisible, position } });
    }
  }
  const creates = wanted
    .map((name, position) => ({ name, position }))
    .filter(({ name }) => !present.has(name))
    .map(({ name, position }) => ({
      fieldMetadataId: fieldIdByName[name],
      position,
      size: 150,
      isVisible: true,
    }));
  return { updates, creates };
};

export const main = async () => {
  const token = await getToken();
  const data = await request(
    '/metadata',
    `{objects(paging:{first:200}){edges{node{id nameSingular
      fieldsList{id name options}}}}}`,
    undefined,
    token,
  );
  const opportunity = data.objects.edges
    .map((edge) => edge.node)
    .find((node) => node.nameSingular === 'opportunity');
  if (!opportunity) throw new Error('Objeto opportunity não encontrado.');

  // Pipeline: troca as opções de `stage`, preservando os ids para migrar os dados existentes.
  const stage = opportunity.fieldsList.find((field) => field.name === 'stage');
  const plan = planStageUpdate(stage.options);
  if (plan.action === 'abort') throw new Error(plan.reason);
  if (plan.action === 'skip') {
    console.log('stage: já configurado, nada a fazer.');
  } else {
    await request(
      '/metadata',
      `mutation($input:UpdateOneFieldMetadataInput!){updateOneField(input:$input){id}}`,
      { input: { id: stage.id, update: { options: plan.options } } },
      token,
    );
    console.log(
      'stage: atualizado para',
      STAGES.map((item) => item.value).join(' > '),
    );
  }

  // Interesse: campo select novo em Opportunity.
  const existingInterest = opportunity.fieldsList.find(
    (field) => field.name === INTEREST_FIELD.name,
  );
  let interestFieldId = existingInterest?.id;
  if (existingInterest) {
    console.log('interesse: já existe, nada a fazer.');
  } else {
    const created = await request(
      '/metadata',
      `mutation($input:CreateOneFieldMetadataInput!){createOneField(input:$input){id}}`,
      {
        input: {
          field: { ...INTEREST_FIELD, objectMetadataId: opportunity.id },
        },
      },
      token,
    );
    interestFieldId = created.createOneField.id;
    console.log('interesse: criado (Imóveis, Veículos).');
  }

  const meta = (query, variables) =>
    request('/metadata', query, variables, token);

  // Workspace: nome de exibição.
  const { currentWorkspace } = await meta(`{currentWorkspace{displayName}}`);
  if (currentWorkspace.displayName === WORKSPACE_NAME) {
    console.log('workspace: já se chama Jean CRM.');
  } else {
    await meta(
      `mutation($data:UpdateWorkspaceInput!){updateWorkspace(data:$data){id}}`,
      { data: { displayName: WORKSPACE_NAME } },
    );
    console.log(`workspace: renomeado para ${WORKSPACE_NAME}.`);
  }

  // Navegação simplificada.
  const objectNameById = Object.fromEntries(
    data.objects.edges.map((edge) => [edge.node.id, edge.node.nameSingular]),
  );
  const { navigationMenuItems } = await meta(
    `{navigationMenuItems{id type position folderId userWorkspaceId targetObjectMetadataId}}`,
  );
  const navigation = planNavigation(navigationMenuItems, objectNameById);
  if (navigation.abort) throw new Error(navigation.abort);
  for (const id of navigation.remove) {
    await meta(`mutation($id:UUID!){deleteNavigationMenuItem(id:$id){id}}`, {
      id,
    });
  }
  const objectIdByName = Object.fromEntries(
    Object.entries(objectNameById).map(([id, name]) => [name, id]),
  );
  for (const item of navigation.create) {
    await meta(
      `mutation($input:CreateNavigationMenuItemInput!){createNavigationMenuItem(input:$input){id}}`,
      {
        input: {
          type: 'OBJECT',
          targetObjectMetadataId: objectIdByName[item.name],
          position: item.position,
        },
      },
    );
  }
  for (const move of navigation.moves) {
    await meta(
      `mutation($input:UpdateOneNavigationMenuItemInput!){updateNavigationMenuItem(input:$input){id}}`,
      { input: { id: move.id, update: { position: move.position } } },
    );
  }
  console.log(
    `navegação: ${navigation.create.length} criados, ${navigation.remove.length} removidos, ${navigation.moves.length} reordenados.`,
  );

  // Views: campo Interesse na tabela principal e views filtradas por interesse.
  const { getViews: views } = await meta(
    `query($id:String){getViews(objectMetadataId:$id){id name type key viewFields{fieldMetadataId position size isVisible} viewFilters{id}}}`,
    { id: opportunity.id },
  );
  const indexView = views.find((view) => view.key === 'INDEX');
  if (!indexView)
    throw new Error('View principal de oportunidades não encontrada.');
  const baseFields = indexView.viewFields.map((field) => ({
    fieldMetadataId: field.fieldMetadataId,
    position: field.position,
    size: field.size,
    isVisible: field.isVisible,
  }));
  const fieldsWithInterest = baseFields.some(
    (field) => field.fieldMetadataId === interestFieldId,
  )
    ? baseFields
    : [
        ...baseFields,
        {
          fieldMetadataId: interestFieldId,
          position: baseFields.length,
          size: 150,
          isVisible: true,
        },
      ];
  if (fieldsWithInterest.length !== baseFields.length) {
    await meta(
      `mutation($input:CreateViewFieldInput!){createViewField(input:$input){id}}`,
      {
        input: {
          viewId: indexView.id,
          ...fieldsWithInterest[fieldsWithInterest.length - 1],
        },
      },
    );
    console.log('views: coluna Interesse adicionada à tabela principal.');
  }

  for (const [index, item] of INTEREST_VIEWS.entries()) {
    let view = views.find((candidate) => candidate.name === item.name);
    if (!view) {
      const created = await meta(
        `mutation($input:CreateViewInput!){createView(input:$input){id viewFilters{id}}}`,
        {
          input: {
            name: item.name,
            objectMetadataId: opportunity.id,
            type: 'TABLE',
            icon: item.icon,
            position: 10 + index,
            visibility: 'WORKSPACE',
          },
        },
      );
      view = { ...created.createView, viewFields: [] };
      console.log(`views: "${item.name}" criada.`);
    } else {
      console.log(`views: "${item.name}" já existe.`);
    }
    if (view.viewFields.length === 0) {
      await meta(
        `mutation($inputs:[CreateViewFieldInput!]!){createManyViewFields(inputs:$inputs){id}}`,
        {
          inputs: fieldsWithInterest.map((field) => ({
            ...field,
            viewId: view.id,
          })),
        },
      );
      console.log(`views: colunas de "${item.name}" criadas.`);
    }
    if (view.viewFilters.length === 0) {
      await meta(
        `mutation($input:CreateViewFilterInput!){createViewFilter(input:$input){id}}`,
        {
          input: {
            viewId: view.id,
            fieldMetadataId: interestFieldId,
            operand: 'IS',
            value: JSON.stringify([item.value]),
          },
        },
      );
      console.log(`views: filtro de "${item.name}" aplicado.`);
    }
  }

  // Colunas comerciais (Pessoas, Empresas, Oportunidades).
  const objectsByName = Object.fromEntries(
    data.objects.edges.map((edge) => [edge.node.nameSingular, edge.node]),
  );
  for (const layout of COLUMN_LAYOUTS) {
    const object = objectsByName[layout.object];
    const fieldIdByName = Object.fromEntries(
      object.fieldsList.map((field) => [field.name, field.id]),
    );
    if (layout.object === 'opportunity')
      fieldIdByName.interesse = interestFieldId;
    const missing = layout.columns.filter((name) => !fieldIdByName[name]);
    if (missing.length > 0) {
      throw new Error(
        `Campos não encontrados em ${layout.object}: ${missing.join(', ')}.`,
      );
    }
    const { getViews: objectViews } = await meta(
      `query($id:String){getViews(objectMetadataId:$id){id name type key viewFields{id fieldMetadataId position size isVisible}}}`,
      { id: object.id },
    );
    for (const view of objectViews.filter(layout.select)) {
      const columnPlan = planColumns(
        view.viewFields,
        layout.columns,
        fieldIdByName,
      );
      for (const update of columnPlan.updates) {
        await meta(
          `mutation($input:UpdateViewFieldInput!){updateViewField(input:$input){id}}`,
          { input: update },
        );
      }
      for (const create of columnPlan.creates) {
        await meta(
          `mutation($input:CreateViewFieldInput!){createViewField(input:$input){id}}`,
          { input: { ...create, viewId: view.id } },
        );
      }
      console.log(
        `colunas: ${layout.object} / ${view.name}: ${columnPlan.updates.length} ajustadas, ${columnPlan.creates.length} criadas.`,
      );
    }
  }
};

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
