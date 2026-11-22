import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const url = process.argv[2] || 'http://127.0.0.1:4173/';
const chromeCandidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);
const chromePath = chromeCandidates.find(existsSync);
if (!chromePath) throw new Error('Chrome ou Edge não encontrado para a auditoria.');

const profileDir = mkdtempSync(join(tmpdir(), 'infotech-performance-'));
const chrome = spawn(chromePath, [
  '--headless=new',
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  '--remote-debugging-port=0',
  `--user-data-dir=${profileDir}`,
  'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });

const endpoint = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('Chrome não iniciou a depuração a tempo.')), 15000);
  let output = '';
  chrome.stderr.setEncoding('utf8');
  chrome.stderr.on('data', (chunk) => {
    output += chunk;
    const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/);
    if (match) {
      clearTimeout(timer);
      resolve(match[1]);
    }
  });
  chrome.once('exit', (code) => {
    clearTimeout(timer);
    reject(new Error(`Chrome encerrou antes da auditoria (código ${code}).`));
  });
});

const socket = new WebSocket(endpoint);
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
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

const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
  const id = ++sequence;
  pending.set(id, { resolve, reject });
  socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
});
const waitForEvent = (method, sessionId, timeout = 15000) => new Promise((resolve, reject) => {
  const key = `${sessionId || ''}:${method}`;
  const timer = setTimeout(() => reject(new Error(`Evento ${method} não ocorreu.`)), timeout);
  const listener = (params) => {
    clearTimeout(timer);
    resolve(params);
  };
  events.set(key, [...(events.get(key) || []), listener]);
});

try {
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  await Promise.all([
    send('Page.enable', {}, sessionId),
    send('Network.enable', {}, sessionId),
    send('Runtime.enable', {}, sessionId),
  ]);
  await send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  }, sessionId);
  await send('Emulation.setCPUThrottlingRate', { rate: 4 }, sessionId);
  await send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 150,
    downloadThroughput: 200000,
    uploadThroughput: 93750,
    connectionType: 'cellular4g',
  }, sessionId);
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.__infotechAudit = { lcp: 0, cls: 0, tbt: 0 };
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) window.__infotechAudit.lcp = Math.max(window.__infotechAudit.lcp, entry.startTime);
      }).observe({ type: 'largest-contentful-paint', buffered: true });
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) if (!entry.hadRecentInput) window.__infotechAudit.cls += entry.value;
      }).observe({ type: 'layout-shift', buffered: true });
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) window.__infotechAudit.tbt += Math.max(0, entry.duration - 50);
      }).observe({ type: 'longtask', buffered: true });
    } catch {}
  ` }, sessionId);

  const loaded = waitForEvent('Page.loadEventFired', sessionId);
  await send('Page.navigate', { url }, sessionId);
  await loaded;
  await new Promise((resolve) => setTimeout(resolve, 1800));

  const { result } = await send('Runtime.evaluate', {
    expression: `(() => {
      const nav = performance.getEntriesByType('navigation')[0];
      const paints = performance.getEntriesByType('paint');
      const resources = performance.getEntriesByType('resource');
      const audit = window.__infotechAudit || {};
      return {
        url: location.href,
        profile: '390x844, CPU 4x, rede móvel simulada',
        ttfbMs: Math.round(nav.responseStart),
        fcpMs: Math.round(paints.find((entry) => entry.name === 'first-contentful-paint')?.startTime || 0),
        lcpMs: Math.round(audit.lcp || 0),
        cls: Number((audit.cls || 0).toFixed(4)),
        tbtMs: Math.round(audit.tbt || 0),
        domContentLoadedMs: Math.round(nav.domContentLoadedEventEnd),
        loadMs: Math.round(nav.loadEventEnd),
        requests: resources.length + 1,
        transferredKB: Math.round((resources.reduce((sum, entry) => sum + (entry.transferSize || 0), 0) + (nav.transferSize || 0)) / 1024),
        largestResources: resources
          .map((entry) => ({ name: entry.name.split('/').pop(), kb: Math.round((entry.transferSize || 0) / 1024) }))
          .sort((a, b) => b.kb - a.kb)
          .slice(0, 5),
      };
    })()`,
    returnByValue: true,
  }, sessionId);
  console.log(JSON.stringify(result.value, null, 2));
} finally {
  socket.close();
  chrome.kill();
  await new Promise((resolve) => setTimeout(resolve, 500));
  if (profileDir.startsWith(tmpdir())) rmSync(profileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
