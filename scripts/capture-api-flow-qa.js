'use strict';

const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const root = path.resolve(__dirname, '..');
const edgePath = ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].find(fs.existsSync);
if (!edgePath) throw new Error('Microsoft Edge is required for API Flow renderer QA');
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const freePort = () => new Promise((resolve, reject) => { const server = net.createServer(); server.once('error', reject); server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => resolve(port)); }); });
async function pollJson(url, timeout = 15_000) { const started = Date.now(); while (Date.now() - started < timeout) { try { const response = await fetch(url); if (response.ok) return response.json(); } catch {} await wait(100); } throw new Error(`Timed out waiting for ${url}`); }
function cdp(socketUrl) { const socket = new WebSocket(socketUrl); let sequence = 0; const pending = new Map(); socket.addEventListener('message', event => { const message = JSON.parse(event.data); if (!message.id) return; const entry = pending.get(message.id); if (!entry) return; pending.delete(message.id); message.error ? entry.reject(new Error(message.error.message)) : entry.resolve(message.result); }); const ready = new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); }); return { ready, close: () => socket.close(), send: async (method, params = {}) => { await ready; const id = ++sequence; return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); }); } }; }

(async () => {
  const serverPort = await freePort(); const debugPort = await freePort();
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kitsune-api-flow-qa-data-'));
  const browserRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kitsune-api-flow-qa-edge-'));
  const outputRoot = path.resolve(process.argv[2] || path.join(root, 'artifacts', 'qa'));
  const server = spawn(process.execPath, ['src/server.js', '--port', String(serverPort)], { cwd: root, env: { ...process.env, KITSUNE_HOST: '127.0.0.1', KITSUNE_USER: 'admin', KITSUNE_PASS: 'visual-qa-password', KITSUNE_DATA_DIR: dataRoot, KITSUNE_DISABLE_SYSTEM_INTEGRATION: '1', KITSUNE_SAFE_MODE: '1' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let serverOutput = ''; server.stdout.on('data', chunk => { serverOutput += chunk; }); server.stderr.on('data', chunk => { serverOutput += chunk; });
  const started = Date.now(); while (!serverOutput.includes('KitsuneServ — Server Mode')) { if (server.exitCode != null) throw new Error(serverOutput); if (Date.now() - started > 15_000) throw new Error(`Server did not start:\n${serverOutput}`); await wait(100); }
  const edge = spawn(edgePath, ['--headless=new', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${browserRoot}`, '--disable-gpu', '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore', windowsHide: true });
  try {
    const pages = await pollJson(`http://127.0.0.1:${debugPort}/json/list`); const page = pages.find(item => item.type === 'page'); if (!page) throw new Error('No Chromium page target');
    const client = cdp(page.webSocketDebuggerUrl); await client.send('Page.enable'); await client.send('Runtime.enable');
    await client.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await client.send('Page.navigate', { url: `http://127.0.0.1:${serverPort}/` }); await wait(350);
    await client.send('Runtime.evaluate', { awaitPromise: true, expression: `(async()=>{await fetch('/auth/login',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:'username=admin&password=visual-qa-password'});location.href='/';})()` });
    let ready = false; for (let attempt = 0; attempt < 100; attempt++) { await wait(100); ready = Boolean((await client.send('Runtime.evaluate', { returnByValue: true, expression: `document.documentElement.dataset.kitsuneReady==='true'` })).result.value); if (ready) break; }
    if (!ready) throw new Error('Renderer did not finish initialization');
    await client.send('Runtime.evaluate', { awaitPromise: true, expression: `(async()=>{switchToPanel('test-lab');setTestLabMode('api-flow');await refreshApiFlows(true);})()` }); await wait(500);
    const inspect = async () => (await client.send('Runtime.evaluate', { returnByValue: true, expression: `(()=>{const panel=document.getElementById('panel-test-lab');const studio=document.getElementById('api-flow-mode');const shell=studio.querySelector('.api-flow-shell');const port=document.getElementById('api-flow-port');const rail=studio.querySelector('.api-flow-left-rail');return {active:panel.classList.contains('active'),studioWidth:Math.round(studio.getBoundingClientRect().width),panelWidth:Math.round(panel.getBoundingClientRect().width),columns:getComputedStyle(shell).gridTemplateColumns,railWidth:Math.round(rail.getBoundingClientRect().width),portVisible:port.getBoundingClientRect().width>0&&port.getBoundingClientRect().height>0,runtimeText:document.getElementById('api-flow-runtime').textContent,nodeFont:parseFloat(getComputedStyle(studio.querySelector('.api-flow-node header strong')).fontSize),endpointFont:parseFloat(getComputedStyle(studio.querySelector('.api-flow-endpoint strong')).fontSize),tabFont:parseFloat(getComputedStyle(studio.querySelector('.api-flow-tabs button')).fontSize),panelOverflow:panel.scrollWidth-panel.clientWidth,documentOverflow:document.documentElement.scrollWidth-document.documentElement.clientWidth,openLabel:document.querySelector('#api-flow-open-url span')?.textContent,copyLabel:document.querySelector('#api-flow-copy-url span')?.textContent}})()` })).result.value;
    const workspace = await inspect();
    if (!workspace.active || workspace.portVisible || /127\.0\.0\.1|:\d{4,5}/.test(workspace.runtimeText) || workspace.railWidth < 230 || workspace.nodeFont < 11 || workspace.endpointFont < 11 || workspace.tabFont < 9 || workspace.panelOverflow > 2 || workspace.documentOverflow > 2 || workspace.openLabel !== 'Otwórz API' || workspace.copyLabel !== 'Kopiuj adres') throw new Error(`API Flow workspace QA failed: ${JSON.stringify(workspace)}`);
    fs.mkdirSync(outputRoot, { recursive: true });
    let image = await client.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); fs.writeFileSync(path.join(outputRoot, 'api-flow-web-1440x900.png'), Buffer.from(image.data, 'base64'));
    await client.send('Runtime.evaluate', { expression: `document.getElementById('api-flow-settings').click()` }); await wait(180);
    const settings = (await client.send('Runtime.evaluate', { returnByValue: true, expression: `(()=>{const dialog=document.getElementById('api-flow-settings-dialog');const network=document.getElementById('api-flow-desktop-network');return {open:!dialog.classList.contains('hidden'),networkHidden:network.classList.contains('hidden'),portVisible:document.getElementById('api-flow-port').getBoundingClientRect().width>0,title:document.getElementById('api-flow-settings-title').textContent,overflow:dialog.scrollWidth-dialog.clientWidth}})()` })).result.value;
    if (!settings.open || !settings.networkHidden || settings.portVisible || settings.overflow > 2) throw new Error(`API Flow settings QA failed: ${JSON.stringify(settings)}`);
    image = await client.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); fs.writeFileSync(path.join(outputRoot, 'api-flow-settings-web-1440x900.png'), Buffer.from(image.data, 'base64'));
    await client.send('Runtime.evaluate', { expression: `document.getElementById('api-flow-settings-close').click();document.querySelector('.api-flow-node').click()` }); await wait(180);
    const inspector = (await client.send('Runtime.evaluate', { returnByValue: true, expression: `(()=>{const studio=document.getElementById('api-flow-mode');const pane=studio.querySelector('.api-flow-inspector');return {open:studio.classList.contains('inspector-open'),width:Math.round(pane.getBoundingClientRect().width),font:parseFloat(getComputedStyle(document.getElementById('api-flow-inspector')).fontSize),overflow:document.getElementById('panel-test-lab').scrollWidth-document.getElementById('panel-test-lab').clientWidth}})()` })).result.value;
    if (!inspector.open || inspector.width < 420 || inspector.font < 11 || inspector.overflow > 2) throw new Error(`API Flow inspector QA failed: ${JSON.stringify(inspector)}`);
    image = await client.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); fs.writeFileSync(path.join(outputRoot, 'api-flow-inspector-web-1440x900.png'), Buffer.from(image.data, 'base64'));
    console.log(JSON.stringify({ outputRoot, workspace, settings, inspector }, null, 2)); client.close();
  } finally {
    edge.kill(); server.kill(); await wait(500);
    for (const directory of [browserRoot, dataRoot]) { try { fs.rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); } catch {} }
  }
})().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
