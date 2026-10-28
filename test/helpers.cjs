const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function loadTs(relativePath, mocks = {}, globals = {}) {
  const filename = path.join(__dirname, '..', relativePath);
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText;
  const module = { exports: {} };
  const logs = [];
  const context = {
    module,
    exports: module.exports,
    require(id) {
      if (Object.hasOwn(mocks, id)) return mocks[id];
      if (id.startsWith('node:')) return require(id);
      throw new Error(`Unmocked import: ${id}`);
    },
    console: { log: (...args) => logs.push(args), error: (...args) => logs.push(args), warn: (...args) => logs.push(args) },
    process: { env: {}, argv: ['node', relativePath], cwd: () => '/isolated', on() {}, once() {}, exitCode: 0 },
    Buffer,
    ...globals,
  };
  vm.runInNewContext(source, context, { filename });
  return { exports: module.exports, logs, context };
}

module.exports = { loadTs };
