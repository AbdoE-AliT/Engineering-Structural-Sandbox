const expr = process.argv[2];
const targets = await (await fetch('http://localhost:9222/json')).json();
const page = targets.find(t => t.type === 'page' && t.url.includes('localhost:5177'));
if (!page) { console.error('page not found'); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const send = (method, params = {}) => new Promise((res, rej) => {
  const mid = ++id;
  pending.set(mid, { res, rej });
  ws.send(JSON.stringify({ id: mid, method, params }));
});
ws.onmessage = ev => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { res, rej } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
  }
};
await new Promise(r => ws.onopen = r);
await send('Runtime.enable');
const result = await send('Runtime.evaluate', {
  expression: expr, awaitPromise: true, returnByValue: true, timeout: 120000
});
if (result.exceptionDetails) {
  console.log('EXCEPTION:', JSON.stringify(result.exceptionDetails, null, 2).slice(0, 4000));
} else {
  console.log(JSON.stringify(result.result.value, null, 2)?.slice(0, 20000));
}
ws.close();
process.exit(0);