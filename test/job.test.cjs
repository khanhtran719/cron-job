const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTs } = require('./helpers.cjs');

function jobFixture({ failWrite = false, failSource = false, metadataEmpty = false, onlyDetailSchema = false, detailTable = 'HoaDon_Sub', rowguid = 'guid' } = {}) {
  const writes = [];
  const columns = { Ca: ['id', 'date'], HoaDon: ['id', 'ca_id'], HoaDon_Sub: ['id', 'source_id', 'rowguid', 'value'], KhachHang: ['id', 'name'], ChiPhi: ['id', 'month'], Phong: ['id', 'name'] };
  columns.HoaDon_Info = ['id', 'bill_id', 'rowguid', 'value'];
  const master = { request: () => ({
    input() { return this; },
    async query(q) {
      if (q.includes('INFORMATION_SCHEMA')) {
        const table = q.match(/WHERE c.TABLE_NAME = '([^']+)'/)[1];
        return { recordset: (metadataEmpty || (onlyDetailSchema && table !== detailTable) ? [] : columns[table]).map(COLUMN_NAME => ({ COLUMN_NAME })) };
      }
      writes.push(q);
      if (failWrite) throw new Error('target write failure');
      return { rowsAffected: [1] };
    },
  }) };
  const store = { request: () => ({ async query(q) {
    if (failSource) throw new Error('source query failure');
    if (/FROM Ca\s/.test(q)) return { recordset: [{ id: 'shift-1' }] };
    if (/FROM HoaDon\s/.test(q)) return { recordset: [{ id: 'invoice-1' }] };
    if (q.includes(`FROM ${detailTable}`)) return { recordset: [1, 2].map(i => ({ id: `sub-${i}`, source_id: 'invoice-1', bill_id: 'invoice-1', rowguid, value: 1 })) };
    throw new Error('Unexpected source table');
  } }) };
  const branches = [{ code: 'A' }];
  const loaded = loadTs('src/jobs/store-2-central.job.ts', {
    fs: { readFileSync: () => JSON.stringify(branches) }, path: require('node:path'), mssql: {},
    '../branch': { assignedBranchs: branches },
    '../database': { connection: { getMasterPool: async () => master, getStorePool: async () => store } },
  });
  return { ...loaded, writes };
}

test('repair preserves parent read-only behavior and returns its write counts', async () => {
  const fixture = jobFixture();
  const result = await fixture.exports.HandleAsyncData(['2026-07-26'], ['HoaDon_Sub'], []);
  assert.equal(result.read, 2);
  assert.equal(result.written, 2);
  assert.equal(result.failed, 0);
  assert.equal(fixture.writes.length, 2);
  assert(fixture.writes.every(q => /UPDATE HoaDon_Sub/.test(q)));
});

test('a failed write does not hide job failure or stop remaining rows', async () => {
  const fixture = jobFixture({ failWrite: true });
  await assert.rejects(fixture.exports.HandleAsyncData(['2026-07-26'], ['HoaDon_Sub'], []), /failed/i);
  assert.equal(fixture.writes.length, 2);
});

test('source query failure is not mistaken for an empty successful date', async () => {
  const fixture = jobFixture({ failSource: true });
  await assert.rejects(fixture.exports.HandleAsyncData(['2026-07-26'], ['HoaDon_Sub'], []), /failed/i);
});

test('missing target table metadata gives a clear error before writing', async () => {
  const fixture = jobFixture({ metadataEmpty: true });
  await assert.rejects(fixture.exports.HandleAsyncData(['2026-07-26'], ['HoaDon_Sub'], []), /HoaDon_Sub/);
  assert.equal(fixture.writes.length, 0);
});

test('repair does not require target metadata for disabled tables or read-only parents', async () => {
  const fixture = jobFixture({ onlyDetailSchema: true });
  const result = await fixture.exports.HandleAsyncData(['2026-07-26'], ['HoaDon_Sub'], ['DoanhThu']);
  assert.equal(result.written, 2);
});

test('rowguid-keyed rows without stable identity fail instead of being duplicated on rerun', async () => {
  const fixture = jobFixture({ detailTable: 'HoaDon_Info', rowguid: null });
  await assert.rejects(fixture.exports.HandleAsyncData(['2026-07-26'], ['HoaDon_Info'], []), /failed/i);
  assert.equal(fixture.writes.length, 0);
});
