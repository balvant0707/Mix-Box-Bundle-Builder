import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMultipleBoxPageRelationData, buildSimpleBoxPageRelationData } from './box-page-persistence.js';

test('buildSimpleBoxPageRelationData preserves page data', () => {
  const result = buildSimpleBoxPageRelationData({ title: 'Simple', status: 'active' });

  assert.deepEqual(result, {
    create: { title: 'Simple', status: 'active' },
    update: { title: 'Simple', status: 'active' },
  });
});

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
