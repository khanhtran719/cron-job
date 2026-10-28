const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTs } = require('./helpers.cjs');

function jobFixture({
  failWrite = false,
  failSource = false,
  metadataEmpty = false,
  onlyActiveSchema = false,
  detailTable = 'HoaDon_Sub',
  rowguid = 'guid',
  failParent,
  mixedParents = false,
} = {}) {
  const writes = [];
  const sourceQueries = [];
  const target = { Ca: new Map(), HoaDon: new Map(), [detailTable]: new Map() };
  const columns = {
    Ca: ['id', 'date', 'rowguid'],
    HoaDon: ['id', 'ca_id', 'rowguid'],
    HoaDon_Sub: ['id', 'source_id', 'rowguid', 'value'],
    KhachHang: ['id', 'name'],
    ChiPhi: ['id', 'month'],
    Phong: ['id', 'name'],
  };
  columns.HoaDon_Info = ['id', 'bill_id', 'rowguid', 'value'];
  const master = {
    request: () => ({
      parameters: {},
      input(name, value) {
        this.parameters[name] = value;
        return this;
      },
      async query(q) {
        if (q.includes('INFORMATION_SCHEMA')) {
          const table = q.match(/WHERE c.TABLE_NAME = '([^']+)'/)[1];
          const activeTables = ['Ca', 'HoaDon', detailTable];
          return {
            recordset: (metadataEmpty || (onlyActiveSchema && !activeTables.includes(table)) ? [] : columns[table]).map(
              (COLUMN_NAME) => ({ COLUMN_NAME }),
            ),
          };
        }
        writes.push(q);
        const table = q.match(/UPDATE (\w+)/)[1];
        if (
          (failWrite && table === detailTable) ||
          (failParent === table && (!mixedParents || this.parameters.id.endsWith('-1')))
        ) {
          throw new Error('target write failure');
        }
        // Simulate foreign keys on the actual target state, not just SQL order.
        if (table === 'HoaDon' && !target.Ca.has(this.parameters.ca_id)) throw new Error('missing target shift');
        if (table === detailTable && !target.HoaDon.has(this.parameters.source_id || this.parameters.bill_id))
          throw new Error('missing target invoice');
        target[table].set(this.parameters.id, { ...this.parameters });
        return { rowsAffected: [1] };
      },
    }),
  };
  const store = {
    request: () => ({
      async query(q) {
        sourceQueries.push(q);
        if (failSource) throw new Error('source query failure');
        if (/FROM Ca\s/.test(q))
          return {
            recordset: (mixedParents ? [1, 2] : [1]).map((i) => ({
              id: `shift-${i}`,
              date: '2026-07-26',
              rowguid: `shift-guid-${i}`,
            })),
          };
        if (/FROM HoaDon\s/.test(q))
          return {
            recordset: (mixedParents ? [1, 2] : [1])
              .filter((i) => q.includes(`'shift-${i}'`))
              .map((i) => ({ id: `invoice-${i}`, ca_id: `shift-${i}`, rowguid: `invoice-guid-${i}` })),
          };
        if (q.includes(`FROM ${detailTable}`))
          return {
            recordset: [1, 2]
              .map((i) => ({
                id: `sub-${i}`,
                source_id: mixedParents ? `invoice-${i}` : 'invoice-1',
                bill_id: mixedParents ? `invoice-${i}` : 'invoice-1',
                rowguid,
                value: 1,
              }))
              .filter((row) => q.includes(`'${row.source_id}'`)),
          };
        throw new Error('Unexpected source table');
      },
    }),
  };
  const branches = [{ code: 'A' }];
  const loaded = loadTs('src/jobs/store-2-central.job.ts', {
    fs: { readFileSync: () => JSON.stringify(branches) },
    path: require('node:path'),
    mssql: {},
    '../branch': { assignedBranchs: branches },
    '../database': { connection: { getMasterPool: async () => master, getStorePool: async () => store } },
  });
  return { ...loaded, writes, sourceQueries, target };
}

test('job writes shifts and invoices before their details, and reruns update the same target rows', async () => {
  const fixture = jobFixture();
  const result = await fixture.exports.HandleAsyncData(['2026-07-26'], ['HoaDon_Sub'], []);
  assert.equal(result.read, 4);
  assert.equal(result.written, 4);
  assert.equal(result.failed, 0);
  assert.deepEqual(
    fixture.writes.map((q) => q.match(/UPDATE (\w+)/)[1]),
    ['Ca', 'HoaDon', 'HoaDon_Sub', 'HoaDon_Sub'],
  );
  assert.equal(fixture.target.Ca.size, 1);
  assert.equal(fixture.target.HoaDon.size, 1);
  assert.equal(fixture.target.HoaDon_Sub.size, 2);
  assert(fixture.writes.slice(0, 2).every((q) => /WHERE id = @id/.test(q)));
  await fixture.exports.HandleAsyncData(['2026-07-26'], ['HoaDon_Sub'], []);
  assert.equal(fixture.target.Ca.size, 1);
  assert.equal(fixture.target.HoaDon.size, 1);
  assert.equal(fixture.target.HoaDon_Sub.size, 2);
});

test('a failed write does not hide job failure or stop remaining rows', async () => {
  const fixture = jobFixture({ failWrite: true });
  await assert.rejects(fixture.exports.HandleAsyncData(['2026-07-26'], ['HoaDon_Sub'], []), /failed/i);
  assert.equal(fixture.writes.filter((q) => /UPDATE HoaDon_Sub/.test(q)).length, 2);
});

test('source query failure is not mistaken for an empty successful date', async () => {
  const fixture = jobFixture({ failSource: true });
  await assert.rejects(fixture.exports.HandleAsyncData(['2026-07-26'], ['HoaDon_Sub'], []), /failed/i);
});

test('missing target table metadata gives a clear error before writing', async () => {
  const fixture = jobFixture({ metadataEmpty: true });
  await assert.rejects(fixture.exports.HandleAsyncData(['2026-07-26'], ['HoaDon_Sub'], []), /Ca|HoaDon_Sub/);
  assert.equal(fixture.writes.length, 0);
});

test('job requires metadata for active parents and details, but not disabled tables', async () => {
  const fixture = jobFixture({ onlyActiveSchema: true });
  const result = await fixture.exports.HandleAsyncData(['2026-07-26'], ['HoaDon_Sub'], ['DoanhThu']);
  assert.equal(result.written, 4);
});

test('rowguid-keyed rows without stable identity fail instead of being duplicated on rerun', async () => {
  const fixture = jobFixture({ detailTable: 'HoaDon_Info', rowguid: null });
  await assert.rejects(fixture.exports.HandleAsyncData(['2026-07-26'], ['HoaDon_Info'], []), /failed/i);
  assert.equal(fixture.writes.filter((q) => /UPDATE HoaDon_Info/.test(q)).length, 0);
});

test('failed shifts are excluded from invoice reads while successful shifts continue', async () => {
  const fixture = jobFixture({ failParent: 'Ca', mixedParents: true });
  await assert.rejects(fixture.exports.HandleAsyncData(['2026-07-26'], ['HoaDon_Sub'], []), /1 error\(s\)/);
  const invoiceQuery = fixture.sourceQueries.find((q) => /FROM HoaDon\s/.test(q));
  assert(!invoiceQuery.includes("'shift-1'"));
  assert(invoiceQuery.includes("'shift-2'"));
  assert.equal(fixture.target.HoaDon.has('invoice-1'), false);
  assert.equal(fixture.target.HoaDon.has('invoice-2'), true);
  assert.equal(fixture.target.HoaDon_Sub.has('sub-2'), true);
});

test('failed invoices are excluded from detail reads while successful invoices continue', async () => {
  const fixture = jobFixture({ failParent: 'HoaDon', mixedParents: true });
  await assert.rejects(fixture.exports.HandleAsyncData(['2026-07-26'], ['HoaDon_Sub'], []), /1 error\(s\)/);
  const detailQuery = fixture.sourceQueries.find((q) => /FROM HoaDon_Sub\s/.test(q));
  assert(!detailQuery.includes("'invoice-1'"));
  assert(detailQuery.includes("'invoice-2'"));
  assert.equal(fixture.target.HoaDon_Sub.has('sub-1'), false);
  assert.equal(fixture.target.HoaDon_Sub.has('sub-2'), true);
});

test('if all shifts or invoices fail, no dependent query is made', async () => {
  for (const failParent of ['Ca', 'HoaDon']) {
    const fixture = jobFixture({ failParent });
    await assert.rejects(fixture.exports.HandleAsyncData(['2026-07-26'], ['HoaDon_Sub'], []), /failed/i);
    assert.equal(
      fixture.sourceQueries.some((q) => /FROM HoaDon_Sub\s/.test(q)),
      false,
    );
    if (failParent === 'Ca')
      assert.equal(
        fixture.sourceQueries.some((q) => /FROM HoaDon\s/.test(q)),
        false,
      );
  }
});
