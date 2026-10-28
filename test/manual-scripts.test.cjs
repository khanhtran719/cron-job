const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function script(file, { failWrites = false, failServer } = {}) {
  const pools = [], reads = [], writes = [], logs = [];
  const process = { env: { MASTER_DB_HOST: 'master', CENTRAL_DB_HOST: 'central' }, cwd: () => '/isolated' };
  process.exit = code => { process.exitCode = code; };
  class Pool {
    constructor(config) { this.config = config; this.connected = false; pools.push(this); }
    async connect() {
      if (this.config.server === failServer) throw new Error('simulated connect failure');
      this.connected = true;
      return this;
    }
    async close() { this.closed = true; this.connected = false; }
    request() {
      const pool = this;
      return {
        input() { return this; },
        async query(query) {
          if (query.includes('INFORMATION_SCHEMA')) {
            if (query.includes("'KhanhHang'")) return { recordset: [] };
            return { recordset: ['id', 'rowguid', 'name'].map(COLUMN_NAME => ({ COLUMN_NAME, DATA_TYPE: 'nvarchar' })) };
          }
          if (pool.config.server === 'store-a' || pool.config.database === 'icool_karaoke_v10' ||
              (file.includes('central-2-master') && pool.config.server === 'master')) {
            reads.push(query);
            return { recordset: [{ id: 'id-1', rowguid: 'guid-1', name: 'customer' }] };
          }
          writes.push(query);
          if (failWrites) throw new Error('simulated write failure');
          return { rowsAffected: [1] };
        },
      };
    }
  }
  let globalPool;
  const sql = { ConnectionPool: Pool, connect: async config => (globalPool ||= await new Pool(config).connect()) };
  let source = fs.readFileSync(file, 'utf8');
  // Expose the legacy IIFE so the regression can await its original behavior.
  if (!source.includes('export async function main')) {
    source = source.replace('(async () => {', 'export async function main() {').replace(/\}\)\(\);\s*$/, '}');
  }
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(code, {
    module, exports: module.exports, process, Buffer,
    console: { log: (...args) => logs.push(args.join(' ')), error: (...args) => logs.push(args.join(' ')) },
    require: name => {
      if (name === 'mssql') return sql;
      if (name === 'dotenv') return { config() {} };
      if (name === 'path') return require('node:path');
      if (name === 'fs') return {
        readFileSync: () => JSON.stringify([{ code: 'A', host: 'store-a' }]),
        existsSync: () => true, mkdirSync() {}, appendFileSync() {},
      };
      throw new Error(`Unexpected import: ${name}`);
    },
  });
  return { run: module.exports.main, pools, process, reads, writes, logs };
}

test('manual customer replication uses KhachHang metadata and closes pools', async () => {
  const state = script('src/scripts/store-replication.ts');
  await state.run();
  assert.equal(state.reads.length, 6);
  assert.equal(state.writes.length, 6);
  assert.notEqual(state.process.exitCode, 1);
  assert(state.pools.every(pool => pool.closed));
});

test('manual customer replication continues rows but reports write failure', async () => {
  const state = script('src/scripts/store-replication.ts', { failWrites: true });
  await state.run();
  assert.equal(state.writes.length, 6);
  assert.equal(state.process.exitCode, 1);
  assert(state.pools.every(pool => pool.closed));
});

test('complaint repair never returns success when target rows fail', async () => {
  const state = script('src/scripts/complain-replication.ts', { failWrites: true });
  await state.run();
  assert.equal(state.writes.length, 4);
  assert.equal(state.process.exitCode, 1);
  assert(state.pools.every(pool => pool.closed));
});

test('partial initialization failure closes already connected pools', async () => {
  const state = script('src/scripts/store-replication.ts', { failServer: 'master' });
  await assert.rejects(state.run(), /simulated connect failure/);
  assert(state.pools.filter(pool => pool.config.server === 'store-a').every(pool => pool.closed));
});

test('customer replication does not depend on the unused Central server', async () => {
  const state = script('src/scripts/store-replication.ts', { failServer: 'central' });
  await state.run();
  assert.equal(state.writes.length, 6);
  assert.equal(state.pools.some(pool => pool.config.server === 'central'), false);
});

test('central script keeps MASTER to CENTRAL direction and closes both pools', async () => {
  const state = script('src/scripts/central-2-master.ts');
  await state.run();
  assert.deepEqual(state.pools.map(pool => pool.config.server).sort(), ['central', 'master']);
  assert(state.reads.length > 0);
  assert(state.writes.some(query => query.includes('MERGE HoaDon_Sub')));
  assert(state.pools.every(pool => pool.closed));
});
