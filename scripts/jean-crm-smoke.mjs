// Smoke test do fluxo comercial: contato -> oportunidade -> interesse -> etapa -> atividade.
// Usa só dados fictícios e remove ao final apenas o que criou. Credenciais por variável de ambiente.
const API_URL = process.env.TWENTY_API_URL ?? 'http://localhost:3000';
const ORIGIN = process.env.TWENTY_ORIGIN ?? 'http://localhost:3001';

const call = async (path, query, variables, token) => {
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

const login = async () => {
  if (process.env.TWENTY_API_KEY) return process.env.TWENTY_API_KEY;
  const { JEAN_CRM_EMAIL: email, JEAN_CRM_PASSWORD: password } = process.env;
  const first = await call(
    '/metadata',
    `mutation($e:String!,$p:String!,$o:String!){getLoginTokenFromCredentials(email:$e,password:$p,origin:$o){loginToken{token}}}`,
    { e: email, p: password, o: ORIGIN },
  );
  const second = await call(
    '/metadata',
    `mutation($t:String!,$o:String!){getAuthTokensFromLoginToken(loginToken:$t,origin:$o){tokens{accessOrWorkspaceAgnosticToken{token}}}}`,
    { t: first.getLoginTokenFromCredentials.loginToken.token, o: ORIGIN },
  );
  return second.getAuthTokensFromLoginToken.tokens
    .accessOrWorkspaceAgnosticToken.token;
};

const check = (condition, message) => {
  if (!condition) throw new Error(`FALHOU: ${message}`);
  console.log(`ok: ${message}`);
};

const runFlow = async (token, interest) => {
  const gql = (query, variables) => call('/graphql', query, variables, token);
  const created = { person: null, opportunity: null, task: null, target: null };
  const tag = `SMOKE-${interest}-${Date.now()}`;
  try {
    created.person = (
      await gql(`mutation($d:PersonCreateInput!){createPerson(data:$d){id}}`, {
        d: {
          name: { firstName: tag, lastName: 'Teste' },
          emails: { primaryEmail: `${tag.toLowerCase()}@example.test` },
          phones: {
            primaryPhoneNumber: '11999990000',
            primaryPhoneCountryCode: 'BR',
            primaryPhoneCallingCode: '+55',
          },
        },
      })
    ).createPerson.id;

    created.opportunity = (
      await gql(
        `mutation($d:OpportunityCreateInput!){createOpportunity(data:$d){id}}`,
        {
          d: {
            name: tag,
            pointOfContactId: created.person,
            interesse: interest,
            stage: 'NEW',
          },
        },
      )
    ).createOpportunity.id;

    for (const stage of ['CONTACTED', 'QUALIFIED', 'NEGOTIATION', 'WON']) {
      await gql(
        `mutation($id:UUID!,$d:OpportunityUpdateInput!){updateOpportunity(id:$id,data:$d){id}}`,
        { id: created.opportunity, d: { stage } },
      );
    }

    created.task = (
      await gql(`mutation($d:TaskCreateInput!){createTask(data:$d){id}}`, {
        d: { title: `Retornar contato ${tag}`, status: 'TODO' },
      })
    ).createTask.id;
    created.target = (
      await gql(
        `mutation($d:TaskTargetCreateInput!){createTaskTarget(data:$d){id}}`,
        {
          d: { taskId: created.task, targetOpportunityId: created.opportunity },
        },
      )
    ).createTaskTarget.id;

    const read = await gql(
      `query($id:UUID!){opportunity(filter:{id:{eq:$id}}){id stage interesse pointOfContact{id} taskTargets{edges{node{task{title}}}}}}`,
      { id: created.opportunity },
    );
    const found = read.opportunity;
    check(found.interesse === interest, `interesse ${interest} persistido`);
    check(found.stage === 'WON', 'etapa final WON persistida');
    check(found.pointOfContact?.id === created.person, 'contato vinculado');
    check(
      found.taskTargets.edges.length === 1,
      'atividade vinculada à oportunidade',
    );
  } finally {
    // Remove só o que este teste criou, na ordem inversa de dependência.
    const destroy = {
      target: ['TaskTarget', created.target],
      task: ['Task', created.task],
      opportunity: ['Opportunity', created.opportunity],
      person: ['Person', created.person],
    };
    for (const [type, id] of Object.values(destroy)) {
      if (!id) continue;
      await gql(`mutation($id:UUID!){destroy${type}(id:$id){id}}`, {
        id,
      }).catch((error) =>
        console.error(`limpeza ${type} falhou: ${error.message.slice(0, 200)}`),
      );
    }
  }
};

const main = async () => {
  const token = await login();
  for (const interest of ['IMOVEIS', 'VEICULOS']) {
    console.log(`--- fluxo ${interest}`);
    await runFlow(token, interest);
  }
  console.log('smoke test concluído');
};

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
