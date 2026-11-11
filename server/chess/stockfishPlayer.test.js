const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { StockfishPlayer } = require('./stockfishPlayer');
class FakeWorker extends EventEmitter {
  constructor(fail = null) {
    super();
    this.fail = fail;
    this.commands = [];
  }
  postMessage(command) {
    this.commands.push(command);
    if (command === 'isready')
      queueMicrotask(() => this.emit('message', 'readyok'));
    if (command.startsWith('go ') && this.fail !== 'timeout')
      queueMicrotask(() =>
        this.fail === 'exit'
          ? this.emit('exit', 1)
          : this.emit('message', 'bestmove e2e4')
      );
  }
  terminate() {
    this.stopped = true;
    return Promise.resolve();
  }
}
test('searches serialize with the reduced bounded budget', async () => {
  const worker = new FakeWorker(),
    engine = new StockfishPlayer({ workerFactory: () => worker });
  await engine.init();
  const result = await Promise.all([
    engine.getBestMove('one'),
    engine.getBestMove('two'),
  ]);
  assert.equal(result.length, 2);
  assert.deepEqual(
    worker.commands.filter((x) => x.startsWith('go ')),
    ['go movetime 150', 'go movetime 150']
  );
  engine.terminate();
});
for (const failure of ['timeout', 'exit'])
  test(`${failure} discards worker before the next queued search`, async () => {
    const first = new FakeWorker(failure),
      second = new FakeWorker();
    const workers = [first, second];
    const engine = new StockfishPlayer({
      timeoutMs: 30,
      workerFactory: () => workers.shift(),
    });
    await engine.init();
    const recovered = engine.getBestMove('one'),
      next = engine.getBestMove('two');
    assert.equal((await recovered).from, 'e2');
    assert.equal((await next).from, 'e2');
    assert.equal(first.stopped, true);
    assert.equal(first.listenerCount('message'), 0);
    engine.terminate();
  });
test('termination rejects active and queued callers', async () => {
  const engine = new StockfishPlayer({
    workerFactory: () => new FakeWorker('timeout'),
  });
  await engine.init();
  const first = engine.getBestMove('one'),
    second = engine.getBestMove('two');
  const result = Promise.allSettled([first, second]);
  await new Promise((resolve) => setImmediate(resolve));
  engine.terminate();
  assert.ok((await result).every((x) => x.status === 'rejected'));
});
