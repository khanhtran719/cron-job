const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTs } = require('./helpers.cjs');

test('standalone defaults to one worker; PM2 validates instance coordinates', () => {
  const single = loadTs('src/constant.ts').exports;
  assert.equal(single.TOTAL_INSTANCES, 1);
  assert.throws(() => loadTs('src/constant.ts', {}, { process: { env: { NODE_APP_INSTANCES: '2', NODE_APP_INSTANCE: '2' } } }), /instance/i);
});

test('one worker covers all branches; four workers cover them exactly once', () => {
  const branches = Array.from({ length: 31 }, (_, i) => ({ code: String(i + 1) }));
  for (const count of [1, 4]) {
    const assignments = [];
    for (let id = 0; id < count; id++) {
      const { exports: mod } = loadTs('src/branch.ts', {
        fs: { readFileSync: () => JSON.stringify(branches) },
        path: require('node:path'),
        './constant': { INSTANCE_ID: id, TOTAL_INSTANCES: count },
      });
      assignments.push(...mod.assignedBranchs.map(b => b.code));
    }
    assert.equal(assignments.length, branches.length);
    assert.equal(new Set(assignments).size, branches.length);
  }
});

test('cron selects Vietnam business date independently of host timezone', () => {
  const { exports: mod } = loadTs('src/cron.ts', { 'node-cron': {}, './jobs': {} });
  assert.equal(mod.getJobDate(new Date('2026-10-27T20:00:00Z')), '2026-10-28');
  assert.equal(mod.getJobDate(new Date('2026-10-28T02:00:00Z')), '2026-10-28');
  assert.equal(mod.getJobDate(new Date('2026-10-28T03:00:00Z')), '2026-10-27');
  assert.equal(mod.getJobDate(new Date('2026-01-01T03:00:00Z')), '2025-12-31');
});

test('cron prevents overlap, reports failure, and can run again after failure', async () => {
  let callback, options, rejectRun, runs = 0;
  const { exports: mod, logs } = loadTs('src/cron.ts', {
    'node-cron': { schedule(expression, cb, config) { callback = cb; options = config; return { stop() {}, destroy() {} }; } },
    './jobs': { HandleAsyncData() { runs++; return new Promise((resolve, reject) => { rejectRun = reject; }); } },
  });
  mod.registerCronJobs();
  const first = callback();
  await Promise.resolve();
  const overlapping = callback();
  assert.equal(runs, 1);
  rejectRun(new Error('target failed'));
  await first;
  await overlapping;
  assert(logs.some(args => args.some(x => String(x).includes('target failed'))));
  const next = callback();
  await Promise.resolve();
  assert.equal(runs, 2);
  rejectRun(new Error('second failure'));
  await next;
  assert.equal(options.timezone, 'Asia/Ho_Chi_Minh');
});

test('stopping cron prevents an already queued callback from starting a new job', async () => {
  let callback, runs = 0;
  const { exports: mod } = loadTs('src/cron.ts', {
    'node-cron': { schedule(expression, cb) { callback = cb; return { stop() {}, destroy() {} }; } },
    './jobs': { HandleAsyncData: async () => { runs++; } },
  });
  const controller = mod.registerCronJobs();
  await controller.stop();
  await callback();
  assert.equal(runs, 0);
});

test('once runs the existing repair and closes pools; cron only registers the schedule', async () => {
  for (const mode of ['once', 'cron']) {
    const events = [];
    const proc = { env: {}, argv: ['node', 'index.js', mode], cwd: () => '/isolated', on() {}, once() {}, exitCode: 0 };
    loadTs('src/index.ts', {
      'dotenv/config': {},
      './branch': { assignedBranchs: [{ code: 'A' }] },
      './constant': { INSTANCE_ID: 0, TOTAL_INSTANCES: 1 },
      './database': { connection: { intialize: async () => events.push('init'), closeAll: async () => events.push('close') } },
      './jobs': { HandleAsyncData: async (...args) => events.push(args) },
      './cron': { registerCronJobs: () => { events.push('schedule'); return { stop() {}, destroy() {} }; } },
    }, { process: proc });
    await new Promise(resolve => setImmediate(resolve));
    if (mode === 'once') {
      assert.equal(events[1][0].join(','), '2026-07-26,2026-07-27,2026-07-28');
      assert.equal(events[1][1].join(','), 'HoaDon_Sub');
      assert.equal(events.at(-1), 'close');
      assert(!events.includes('schedule'));
    } else {
      assert.deepEqual(events, ['init', 'schedule']);
    }
  }
});

test('once exposes a failed job as nonzero exit and closes pools', async () => {
  let closed = false;
  const proc = { env: {}, argv: ['node', 'index.js', 'once'], cwd: () => '/isolated', on() {}, once() {}, exitCode: 0 };
  loadTs('src/index.ts', {
    'dotenv/config': {},
    './branch': { assignedBranchs: [{ code: 'A' }] },
    './constant': { INSTANCE_ID: 0, TOTAL_INSTANCES: 1 },
    './database': { connection: { intialize: async () => {}, closeAll: async () => { closed = true; } } },
    './jobs': { HandleAsyncData: async () => { throw new Error('target failed'); } },
    './cron': { registerCronJobs() {} },
  }, { process: proc });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(proc.exitCode, 1);
  assert.equal(closed, true);
});

test('cron shutdown waits for the current run before closing database pools', async () => {
  const handlers = {};
  let finishRun, closed = false;
  const proc = {
    env: { JOB_MODE: 'cron' }, argv: ['node', 'index.js'],
    once(signal, handler) { handlers[signal] = handler; }, exitCode: 0,
  };
  loadTs('src/index.ts', {
    'dotenv/config': {},
    './branch': { assignedBranchs: [{ code: 'A' }] },
    './constant': { INSTANCE_ID: 0, TOTAL_INSTANCES: 1 },
    './database': { connection: { intialize: async () => {}, closeAll: async () => { closed = true; } } },
    './jobs': {},
    './cron': { registerCronJobs: () => ({ stop: () => new Promise(resolve => { finishRun = resolve; }) }) },
  }, { process: proc });
  await new Promise(resolve => setImmediate(resolve));
  const shutdown = handlers.SIGTERM();
  await Promise.resolve();
  assert.equal(closed, false);
  finishRun();
  await shutdown;
  assert.equal(closed, true);
});

test('initialization failure is nonzero and still closes partially opened pools', async () => {
  let closed = false;
  const proc = { env: {}, argv: ['node', 'index.js', 'once'], once() {}, exitCode: 0 };
  loadTs('src/index.ts', {
    'dotenv/config': {},
    './branch': { assignedBranchs: [{ code: 'A' }] },
    './constant': { INSTANCE_ID: 0, TOTAL_INSTANCES: 1 },
    './database': { connection: {
      intialize: async () => { throw new Error('master unavailable'); },
      closeAll: async () => { closed = true; },
    } },
    './jobs': {}, './cron': {},
  }, { process: proc });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(closed, true);
  assert.equal(proc.exitCode, 1);
});
