import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMultipleBoxPageRelationData } from './box-page-persistence.js';

test('buildMultipleBoxPageRelationData keeps quantity packs in create and update payloads', () => {
  const relationData = buildMultipleBoxPageRelationData(
    { title: 'Bundle', description: undefined, status: 'active' },
    [{ title: 'Pack A', packKey: 'A' }],
  );

  assert.deepEqual(relationData.create, {
    title: 'Bundle',
    status: 'active',
    quantityPacks: { create: [{ title: 'Pack A', packKey: 'A' }] },
  });

  assert.deepEqual(relationData.update, {
    title: 'Bundle',
    status: 'active',
    quantityPacks: {
      deleteMany: {},
      create: [{ title: 'Pack A', packKey: 'A' }],
    },
  });
});
