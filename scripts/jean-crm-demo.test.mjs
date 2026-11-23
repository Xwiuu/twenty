// Protege o formato da massa de demonstração. Rodar: node --test scripts/jean-crm-demo.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DEMO_DEALS, DEMO_NOTES } from './jean-crm-demo.mjs';

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
