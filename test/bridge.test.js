const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const path = require('node:path');
const { test } = require('node:test');
const WebSocket = require('ws');

/** Exercise the real bridge on an ephemeral port without a user's browser. */
class Bridge {
  constructor() {
    this.sockets = [];
    this.process = spawn(process.execPath, [path.join(__dirname, '../bridge-server/server.js'), '--port', '0']);
  }

  async start(t) {
    t.after(async () => {
      for (const socket of this.sockets) socket.terminate();
      if (this.process.exitCode === null) {
        const exited = once(this.process, 'exit');
        this.process.kill();
        await exited;
      }
    });
    this.url = await new Promise((resolve, reject) => {
      let output = '';
      const timer = setTimeout(() => reject(new Error('Bridge did not start: ' + output)), 5000);
      this.process.stderr.on('data', data => {
        output += data;
        const match = output.match(/listening on (ws:\/\/127\.0\.0\.1:\d+)/);
        if (match) { clearTimeout(timer); resolve(match[1]); }
      });
      this.process.on('error', error => { clearTimeout(timer); reject(error); });
    });
    return this;
  }

  /** Capture messages immediately, including events arriving before assertions. */
  async connect(options = {}) {
    const socket = new WebSocket(this.url, options);
    this.sockets.push(socket);
    socket.messages = [];
    socket.on('message', data => socket.messages.push(JSON.parse(data)));
    await once(socket, 'open');
    return socket;
  }

  async next(socket, predicate) {
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      const index = socket.messages.findIndex(predicate);
      if (index !== -1) return socket.messages.splice(index, 1)[0];
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error('Expected bridge message; received ' + JSON.stringify(socket.messages));
  }

  send(socket, message) { socket.send(JSON.stringify(message)); }

  async agent(session) {
    const socket = await this.connect();
    this.send(socket, { type: 'session_start', session, name: session });
    await this.next(socket, msg => msg.type === 'session_started');
    return socket;
  }

  async extension(options = {}) {
    const socket = await this.connect(options);
    this.send(socket, { type: 'event', event: 'connected', data: { instanceId: 'test-install', browser: 'firefox' } });
    return socket;
  }


}

test('accept native clients and installed-browser extension origins', async t => {
  const bridge = await new Bridge().start(t);
  for (const origin of [undefined, 'chrome-extension://abcdefghijklmnopabcdefghijklmnop', 'moz-extension://12345678-1234-1234-1234-123456789abc']) {
    const socket = await bridge.connect(origin ? { origin } : {});
    socket.close();
  }
  const local = await bridge.connect({ headers: { Host: `localhost:${new URL(bridge.url).port}` } });
  local.close();
});

test('reject website/opaque origins and DNS-rebinding hosts at HTTP upgrade', async t => {
  const bridge = await new Bridge().start(t);
  for (const options of [
    { origin: 'https://example.com' },
    { origin: 'http://localhost:8080' },
    { origin: 'null' },
    { origin: 'moz-extension://12345678-1234-1234-1234-123456789abc.evil.test' },
    { headers: { Host: 'rebind.example:9334' } },
    { headers: { Host: 'localhost.evil.test:9334' } },
    { origin: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop', headers: { Host: 'evil.test' } },
  ]) {
    await assert.rejects(bridge.connect(options), /403/);
  }
});

test('two agents receive only their own results even with spoofed session tags', async t => {
  const bridge = await new Bridge().start(t);
  const extension = await bridge.extension();
  const first = await bridge.agent('first');
  const second = await bridge.agent('second');
  bridge.send(first, { type: 'action', action: 'get_dom', id: 'one', session: 'second' });
  const action = await bridge.next(extension, msg => msg.id === 'one');
  assert.equal(action.session, 'first');
  bridge.send(extension, { type: 'result', session: action.session, id: action.id, success: true });
  await bridge.next(first, msg => msg.id === 'one');
  bridge.send(second, { type: 'action', action: 'get_dom', id: 'two' });
  await bridge.next(extension, msg => msg.id === 'two');
  assert.equal(second.messages.some(msg => msg.id === 'one'), false);
});

test('reject duplicate session IDs without disconnecting their owner', async t => {
  const bridge = await new Bridge().start(t);
  const extension = await bridge.extension();
  const owner = await bridge.agent('shared');
  const duplicate = await bridge.connect();
  const closed = once(duplicate, 'close');
  bridge.send(duplicate, { type: 'session_start', session: 'shared', name: 'Other agent' });
  assert.equal((await closed)[0], 4003);
  bridge.send(owner, { type: 'action', action: 'get_dom', id: 'still-owned' });
  const action = await bridge.next(extension, msg => msg.id === 'still-owned');
  bridge.send(extension, { type: 'result', session: action.session, id: action.id, success: true });
  await bridge.next(owner, msg => msg.id === 'still-owned');
  assert.equal(extension.messages.some(msg => msg.type === 'session_end'), false);
});

test('repeated handshakes and forged extension messages do not reset tab state', async t => {
  const bridge = await new Bridge().start(t);
  const extension = await bridge.extension();
  const agent = await bridge.agent('one');
  await bridge.next(extension, msg => msg.type === 'session_start');
  bridge.send(agent, { type: 'session_start', session: 'other', name: 'Other' });
  assert.equal((await bridge.next(agent, msg => msg.type === 'session_started')).session, 'one');
  bridge.send(agent, { type: 'event', event: 'connected' });
  bridge.send(agent, { type: 'result', id: 'forged', success: true });
  bridge.send(agent, { type: 'action', action: 'get_dom', id: 'barrier' });
  await bridge.next(extension, msg => msg.id === 'barrier');
  assert.deepEqual(extension.messages, []);
});

test('extension reconnect delivers live work but never a disconnected agent action', async t => {
  const bridge = await new Bridge().start(t);
  const abandoned = await bridge.agent('abandoned');
  bridge.send(abandoned, { type: 'action', action: 'click', id: 'must-not-run' });
  const closed = once(abandoned, 'close');
  abandoned.close();
  await closed;
  const live = await bridge.agent('live');
  bridge.send(live, { type: 'action', action: 'get_dom', id: 'live-work' });
  const extension = await bridge.extension();
  const action = await bridge.next(extension, msg => msg.id === 'live-work');
  assert.equal(action.session, 'live');
  assert.equal(extension.messages.some(msg => msg.id === 'must-not-run' || msg.session === 'abandoned'), false);
});

test('explicit session end closes its connection rather than leaving a usable route', async t => {
  const bridge = await new Bridge().start(t);
  const extension = await bridge.extension();
  const agent = await bridge.agent('ended');
  const closed = once(agent, 'close');
  bridge.send(agent, { type: 'session_end' });
  assert.equal((await closed)[0], 1000);
  await bridge.next(extension, msg => msg.type === 'session_end' && msg.session === 'ended');
});
