// Configura o CRM do Jean pela API de metadata do Twenty. Idempotente: pode rodar várias vezes.
// Uso: veja docs/JEAN_CRM.md. Credenciais só por variáveis de ambiente.
const API_URL = process.env.TWENTY_API_URL ?? 'http://localhost:3000';
const ORIGIN = process.env.TWENTY_ORIGIN ?? 'http://localhost:3001';

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

const request = async (path, query, variables, token) => {
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

const getToken = async () => {
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

const main = async () => {
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
  const wanted = STAGES.map((item) => item.value);
  if (sameValues(stage.options, wanted)) {
    console.log('stage: já configurado, nada a fazer.');
  } else {
    const legacy = STAGES.filter((item) => item.legacyValue).map(
      (item) => item.legacyValue,
    );
    const current = stage.options.map((option) => option.value);
    const isStock = legacy.every((value) => current.includes(value));
    if (!isStock) {
      throw new Error(
        `stage tem opções inesperadas (${current.join(', ')}). Abortando para não sobrescrever.`,
      );
    }
    const options = STAGES.map((item, position) => {
      const existing = stage.options.find(
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
    await request(
      '/metadata',
      `mutation($input:UpdateOneFieldMetadataInput!){updateOneField(input:$input){id}}`,
      { input: { id: stage.id, update: { options } } },
      token,
    );
    console.log('stage: atualizado para', wanted.join(' > '));
  }

  // Interesse: campo select novo em Opportunity.
  const existingInterest = opportunity.fieldsList.find(
    (field) => field.name === INTEREST_FIELD.name,
  );
  if (existingInterest) {
    console.log('interesse: já existe, nada a fazer.');
  } else {
    await request(
      '/metadata',
      `mutation($input:CreateOneFieldMetadataInput!){createOneField(input:$input){id}}`,
      {
        input: {
          field: { ...INTEREST_FIELD, objectMetadataId: opportunity.id },
        },
      },
      token,
    );
    console.log('interesse: criado (Imóveis, Veículos).');
  }
};

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
