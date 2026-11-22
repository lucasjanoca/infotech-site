import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const coversDir = join(root, 'assets', 'covers');
const files = readdirSync(coversDir)
  .filter((file) => file.endsWith('.webp') && !file.endsWith('-960.webp'));
const chromeCandidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);
const chromePath = chromeCandidates.find(existsSync);
if (!chromePath) throw new Error('Chrome ou Edge não encontrado para otimizar as capas.');

const profileDir = mkdtempSync(join(tmpdir(), 'infotech-covers-'));
const chrome = spawn(chromePath, [
  '--headless=new',
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  '--remote-debugging-port=0',
  `--user-data-dir=${profileDir}`,
  'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });

const endpoint = await new Promise((resolveEndpoint, reject) => {
  const timer = setTimeout(() => reject(new Error('Chrome não iniciou a tempo.')), 15000);
  let output = '';
  chrome.stderr.setEncoding('utf8');
  chrome.stderr.on('data', (chunk) => {
    output += chunk;
    const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/);
    if (match) {
      clearTimeout(timer);
      resolveEndpoint(match[1]);
    }
  });
});

const socket = new WebSocket(endpoint);
await new Promise((resolveOpen, reject) => {
  socket.addEventListener('open', resolveOpen, { once: true });
  socket.addEventListener('error', reject, { once: true });
});

let sequence = 0;
const pending = new Map();
const events = new Map();
socket.addEventListener('message', ({ data }) => {
  const message = JSON.parse(data);
  if (message.id) {
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
    return;
  }
  const key = `${message.sessionId || ''}:${message.method}`;
  const listeners = events.get(key) || [];
  events.delete(key);
  for (const listener of listeners) listener(message.params);
});
const send = (method, params = {}, sessionId) => new Promise((resolveSend, reject) => {
  const id = ++sequence;
  pending.set(id, { resolve: resolveSend, reject });
  socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
});
const waitForEvent = (method, sessionId, timeout = 15000) => new Promise((resolveEvent, reject) => {
  const key = `${sessionId || ''}:${method}`;
  const timer = setTimeout(() => reject(new Error(`Evento ${method} não ocorreu.`)), timeout);
  const listener = (params) => {
    clearTimeout(timer);
    resolveEvent(params);
  };
  events.set(key, [...(events.get(key) || []), listener]);
});

try {
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  await Promise.all([send('Page.enable', {}, sessionId), send('Runtime.enable', {}, sessionId)]);
  const loaded = waitForEvent('Page.loadEventFired', sessionId);
  await send('Page.navigate', { url: 'http://127.0.0.1:4173/' }, sessionId);
  await loaded;

  for (const file of files) {
    const source = `/assets/covers/${file}`;
    const { result, exceptionDetails } = await send('Runtime.evaluate', {
      expression: `(async () => {
        const response = await fetch(${JSON.stringify(source)});
        if (!response.ok) throw new Error('Falha ao carregar ${file}');
        const bitmap = await createImageBitmap(await response.blob());
        const width = Math.min(960, bitmap.width);
        const height = Math.round(bitmap.height * width / bitmap.width);
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d', { alpha: false });
        context.drawImage(bitmap, 0, 0, width, height);
        const blob = await new Promise((resolveBlob) => canvas.toBlob(resolveBlob, 'image/webp', 0.8));
        const bytes = new Uint8Array(await blob.arrayBuffer());
        let binary = '';
        for (let offset = 0; offset < bytes.length; offset += 32768) {
          binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
        }
        return { width, height, data: btoa(binary) };
      })()`,
      awaitPromise: true,
      returnByValue: true,
    }, sessionId);
    if (exceptionDetails) throw new Error(exceptionDetails.text || `Falha ao otimizar ${file}`);
    const output = join(coversDir, file.replace(/\.webp$/, '-960.webp'));
    writeFileSync(output, Buffer.from(result.value.data, 'base64'));
    console.log(`${file} -> ${result.value.width}x${result.value.height}`);
  }
} finally {
  socket.close();
  chrome.kill();
  await new Promise((resolveWait) => setTimeout(resolveWait, 500));
  if (profileDir.startsWith(tmpdir())) rmSync(profileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
