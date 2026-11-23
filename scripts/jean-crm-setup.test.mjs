// Testes da decisão de migração do pipeline. Rodar: node --test scripts/
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { planStageUpdate } from './jean-crm-setup.mjs';

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
