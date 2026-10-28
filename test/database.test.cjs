const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function database() {
  const pools = [];
  class Pool {
    constructor(config) { this.config = config; this.connected = false; pools.push(this); }
    async connect() {
      if (this.config.server === 'central-down') throw new Error('Central unavailable');
      this.connected = true;
      return this;
    }
    async close() { this.connected = false; this.closed = true; }
  }
  let globalPool;
  const sql = { ConnectionPool: Pool, connect: async config => (globalPool ||= await new Pool(config).connect()) };
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync('src/database.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(code, {
    module, exports: module.exports, console: { log() {}, error() {} },
    process: { env: { MASTER_DB_HOST: 'master', MASTER_DB_NAME: 'master-db', CENTRAL_DB_HOST: 'central-down' } },
    require: name => {
      if (name === 'dotenv') return { config() {} };
      if (name === 'mssql') return sql;
      throw new Error(`Unexpected import: ${name}`);
    },
  });
  return { service: module.exports.connection, pools };
}

test('different store configurations never share the global SQL pool', async () => {
  const { service } = database();
  const a = await service.getStorePool({ code: 'A', host: 'store-a' });
  const b = await service.getStorePool({ code: 'B', host: 'store-b' });
  assert.notEqual(a, b);
  assert.equal(b.config.server, 'store-b');
});

test('a disconnected cached store pool is replaced', async () => {
  const { service } = database();
  const branch = { code: 'A', host: 'store-a' };
  const old = await service.getStorePool(branch);
  old.connected = false;
  const replacement = await service.getStorePool(branch);
  assert.notEqual(old, replacement);
  assert.equal(replacement.connected, true);
});

test('main initialization does not require the unused Central database', async () => {
  const { service, pools } = database();
  await service.intialize([]);
  assert.equal((await service.getMasterPool()).config.server, 'master');
  assert.equal(pools.some(pool => pool.config.server === 'central-down'), false);
});

test('closeAll closes every pool and allows a later fresh connection', async () => {
  const { service, pools } = database();
  await service.intialize([{ code: 'A', host: 'store-a' }]);
  const old = await service.getMasterPool();
  await service.closeAll();
  assert(pools.every(pool => pool.closed));
  assert.notEqual(await service.getMasterPool(), old);
});
