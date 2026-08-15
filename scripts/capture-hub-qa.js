'use strict';

const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const root = path.resolve(__dirname, '..');
const edgePath = ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].find(fs.existsSync);
if (!edgePath) throw new Error('Microsoft Edge is required for renderer QA');

function freePort() { return new Promise((resolve, reject) => { const server = net.createServer(); server.once('error', reject); server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => resolve(port)); }); }); }
function wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
async function pollJson(url, timeout = 15_000) { const started = Date.now(); while (Date.now() - started < timeout) { try { const response = await fetch(url); if (response.ok) return response.json(); } catch {} await wait(100); } throw new Error(`Timed out waiting for ${url}`); }
function cdp(socketUrl) {
  const socket = new WebSocket(socketUrl); let sequence = 0; const pending = new Map();
  socket.addEventListener('message', event => { const message = JSON.parse(event.data); if (!message.id) return; const entry = pending.get(message.id); if (!entry) return; pending.delete(message.id); message.error ? entry.reject(new Error(message.error.message)) : entry.resolve(message.result); });
  const ready = new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  return { ready, close: () => socket.close(), send: async (method, params = {}) => { await ready; const id = ++sequence; return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); }); } };
}

(async () => {
  const requestedTab = process.argv[3] || 'overview';
  if (!['overview', 'nodes', 'sync', 'routes', 'users', 'plesk', 'connections', 'settings'].includes(requestedTab)) throw new Error(`Unknown Hub QA tab: ${requestedTab}`);
  const serverPort = await freePort(); const debugPort = await freePort(); const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kitsune-hub-qa-data-')); const browserRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kitsune-hub-qa-edge-'));
  const server = spawn(process.execPath, ['src/server.js', '--port', String(serverPort)], { cwd: root, env: { ...process.env, KITSUNE_HOST: '127.0.0.1', KITSUNE_USER: 'admin', KITSUNE_PASS: 'visual-qa-password', KITSUNE_DATA_DIR: dataRoot, KITSUNE_DISABLE_SYSTEM_INTEGRATION: '1', KITSUNE_SAFE_MODE: '1' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let serverOutput = ''; server.stdout.on('data', chunk => { serverOutput += chunk; }); server.stderr.on('data', chunk => { serverOutput += chunk; });
  const readyStarted = Date.now(); while (!serverOutput.includes('KitsuneServ — Server Mode')) { if (server.exitCode != null) throw new Error(serverOutput); if (Date.now() - readyStarted > 15_000) throw new Error(`Server did not start:\n${serverOutput}`); await wait(100); }
  const edge = spawn(edgePath, [`--headless=new`, `--remote-debugging-port=${debugPort}`, `--user-data-dir=${browserRoot}`, '--disable-gpu', '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore', windowsHide: true });
  try {
    const pages = await pollJson(`http://127.0.0.1:${debugPort}/json/list`); const page = pages.find(item => item.type === 'page'); if (!page) throw new Error('No Chromium page target'); const client = cdp(page.webSocketDebuggerUrl);
    await client.send('Page.enable'); await client.send('Runtime.enable'); await client.send('Emulation.setDeviceMetricsOverride', { width: 1360, height: 860, deviceScaleFactor: 1, mobile: false });
    await client.send('Page.navigate', { url: `http://127.0.0.1:${serverPort}/` }); await wait(400);
    await client.send('Runtime.evaluate', { awaitPromise: true, expression: `(async()=>{await fetch('/auth/login',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:'username=admin&password=visual-qa-password'});location.href='/';})()` }); await wait(1000);
    await client.send('Runtime.evaluate', { expression: `document.querySelector('[data-panel="hub"]').click()` }); await wait(1200);
    if (requestedTab !== 'overview') { await client.send('Runtime.evaluate', { expression: `document.querySelector('[data-hub-tab="${requestedTab}"]').click()` }); await wait(300); }
    const metrics = await client.send('Runtime.evaluate', { returnByValue: true, expression: `(()=>{const p=document.getElementById('panel-hub');const shell=p.querySelector('.hub-shell');const view=p.querySelector('[data-hub-view="${requestedTab}"]');return {panel:p.getBoundingClientRect().toJSON(),shell:shell.getBoundingClientRect().toJSON(),view:view?.getBoundingClientRect().toJSON(),scrollWidth:p.scrollWidth,clientWidth:p.clientWidth,active:p.classList.contains('active'),activeTab:p.querySelector('[data-hub-tab].active')?.dataset.hubTab,title:document.getElementById('hub-domain-display').textContent}})()` });
    if (!metrics.result.value.active || metrics.result.value.activeTab !== requestedTab || metrics.result.value.scrollWidth > metrics.result.value.clientWidth + 2) throw new Error(`Hub layout overflow: ${JSON.stringify(metrics.result.value)}`);
    const image = await client.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); const output = path.resolve(process.argv[2] || path.join(root, 'artifacts', 'qa', 'hub-1360x860.png')); fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, Buffer.from(image.data, 'base64')); console.log(JSON.stringify({ output, metrics: metrics.result.value }, null, 2)); client.close();
  } finally {
    edge.kill(); server.kill(); await wait(500);
    for (const directory of [browserRoot, dataRoot]) { try { fs.rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); } catch {} }
  }
})().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
