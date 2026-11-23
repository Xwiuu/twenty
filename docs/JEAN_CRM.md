# Jean CRM — configuração (Sprint 01)

Base: Twenty `v2.9.0`. Ambiente local: veja `docs/JEAN_SETUP.md` (no `main`). Nenhum código-fonte do Twenty foi alterado; tudo é configuração via API de metadata.

## O que foi configurado

Usa só objetos nativos do Twenty:

| Necessidade | Onde está |
|---|---|
| Contato (nome, e-mail, telefone) | Objeto nativo **People** |
| Oportunidade | Objeto nativo **Opportunities** (contato = `pointOfContact`, responsável = `owner`) |
| Interesse | Campo novo **Interesse** em Opportunities: `Imóveis` / `Veículos` |
| Pipeline | Campo nativo `stage` com as opções abaixo |
| Atividades (ligar, retornar, visita/reunião, observações) | **Tasks** e **Notes** nativas, vinculadas à oportunidade |

Não existem objetos de imóvel ou veículo.

### Pipeline (`stage`)

| Valor | Etapa | Antes (padrão Twenty) |
|---|---|---|
| `NEW` | Novo | New |
| `CONTACTED` | Contatado | Screening |
| `QUALIFIED` | Qualificado | Meeting |
| `NEGOTIATION` | Negociação | Proposal |
| `WON` | Ganho | Customer |
| `LOST` | Perdido | (novo) |

Oportunidades existentes migram pelo id da opção (Screening vira Contatado etc.). O Kanban "By Stage" já reflete as 6 colunas.

## Reproduzir em outro ambiente

Com o Twenty rodando, rode a partir da raiz:

```bash
JEAN_CRM_EMAIL=<email> JEAN_CRM_PASSWORD=<senha> node scripts/jean-crm-setup.mjs
# ou, com chave de API: TWENTY_API_KEY=<chave> node scripts/jean-crm-setup.mjs
```

- Variáveis opcionais: `TWENTY_API_URL` (padrão `http://localhost:3000`) e `TWENTY_ORIGIN` (padrão `http://localhost:3001`).
- É idempotente: se já estiver configurado, não faz nada. Aborta, sem alterar, se `stage` tiver opções que não sejam as padrão do Twenty nem as do Jean.
- Configura apenas o workspace do usuário informado.
- Nada de credenciais no código.

## Como usar

- **Novo lead:** People → criar contato. Opportunities → criar oportunidade, escolher o contato, `Interesse` e o responsável.
- **Pipeline:** Opportunities → view "By Stage"; arraste o card entre as colunas.
- **Acompanhamento:** na oportunidade, aba Tasks → criar tarefa (ligar, retornar, visita/reunião) com data. Anotações em Notes.

## Validar

```bash
JEAN_CRM_EMAIL=<email> JEAN_CRM_PASSWORD=<senha> node scripts/jean-crm-smoke.mjs
```

Teste unitário da regra de migração do pipeline (sem banco, sem dependências): `node --test scripts/jean-crm-setup.test.mjs`.

O smoke cria contato, oportunidade com interesse Imóveis e depois Veículos, percorre as etapas até `WON`, cria tarefa vinculada, confere a persistência e remove só o que criou.

## Limitações conhecidas

- Um workspace por execução. Em ambiente de dev há outros workspaces de demonstração que não são alterados.
- O banco de dev contém dados de demonstração do Twenty (empresas, pessoas, 50 oportunidades). Não são dados do Jean.
- Uma sincronização futura do Twenty com a definição padrão de `stage` pode sobrescrever as opções. Se acontecer, rode o script de novo.
- Valores `NEW`..`LOST` ficam em inglês (rótulos em português). O valor padrão `NEW` foi mantido para não mexer no padrão do campo.
- O smoke test valida por API. A conferência visual do Kanban não foi feita por esta automação.
