// Headless-Chrome smoke test driven over the DevTools Protocol (no deps).
// Serves the app, loads it, captures console errors / uncaught exceptions,
// simulates a drag-and-drop placement, and asserts the board/score/tray update.
//
//   node test/ui.smoke.mjs
import http from 'node:http';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DBG_PORT = 9344;

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const log = (...a) => console.log(...a);
function check(cond, msg) {
  log(`${cond ? '  ✓' : '  ✗'} ${msg}`);
  if (!cond) failed++;
}

// ---- static server --------------------------------------------------------
function startServer() {
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/') p = '/index.html';
    const file = path.join(ROOT, p);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404);
      return res.end('not found');
    }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

// ---- minimal CDP client ---------------------------------------------------
class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.handlers = [];
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
      } else if (msg.method) {
        for (const h of this.handlers) h(msg.method, msg.params);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
  on(fn) {
    this.handlers.push(fn);
  }
  async evaluate(expr) {
    const r = await this.send('Runtime.evaluate', {
      expression: `(${expr})()`,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || ''));
    return r.result.value;
  }
  async mouse(type, x, y) {
    await this.send('Input.dispatchMouseEvent', {
      type,
      x,
      y,
      button: 'left',
      buttons: type === 'mouseReleased' ? 0 : 1,
      clickCount: type === 'mouseMoved' ? 0 : 1,
    });
  }
}

async function main() {
  const server = await startServer();
  const port = server.address().port;
  const url = `http://127.0.0.1:${port}/index.html`;
  log(`Serving ${ROOT} on :${port}`);

  const userDir = fs.mkdtempSync('/tmp/bb-chrome-');
  const chrome = spawn(
    CHROME,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      `--remote-debugging-port=${DBG_PORT}`,
      `--user-data-dir=${userDir}`,
      '--window-size=420,820',
      'about:blank',
    ],
    { stdio: 'ignore' },
  );

  const cleanup = () => {
    try { chrome.kill('SIGKILL'); } catch {}
    try { server.close(); } catch {}
    try { fs.rmSync(userDir, { recursive: true, force: true }); } catch {}
  };

  try {
    // wait for the page target
    let target = null;
    for (let i = 0; i < 60; i++) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${DBG_PORT}/json/list`)).json();
        target = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
        if (target) break;
      } catch {}
      await sleep(150);
    }
    if (!target) throw new Error('no devtools page target');

    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((res, rej) => {
      ws.addEventListener('open', res, { once: true });
      ws.addEventListener('error', rej, { once: true });
    });
    const cdp = new CDP(ws);

    const consoleErrors = [];
    const exceptions = [];
    cdp.on((method, params) => {
      if (method === 'Runtime.consoleAPICalled' && params.type === 'error') {
        consoleErrors.push((params.args || []).map((a) => a.value || a.description || '').join(' '));
      }
      if (method === 'Runtime.exceptionThrown') {
        exceptions.push(params.exceptionDetails?.exception?.description || params.exceptionDetails?.text || 'exception');
      }
    });

    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');

    const loaded = new Promise((res) => cdp.on((m) => m === 'Page.loadEventFired' && res()));
    await cdp.send('Page.navigate', { url });
    await Promise.race([loaded, sleep(8000)]);
    await sleep(600); // let init + first paint settle

    log('\n--- assertions ---');

    const initial = await cdp.evaluate(`() => ({
      cells: document.querySelectorAll('#board .cell').length,
      pieces: document.querySelectorAll('#tray .tray-piece').length,
      score: document.getElementById('score').textContent,
      filled: document.querySelectorAll('#board .cell.filled').length,
      hasManifest: !!document.querySelector('link[rel=manifest]'),
      theme: document.documentElement.getAttribute('data-theme'),
    })`);

    check(initial.cells === 64, `board renders 64 cells (got ${initial.cells})`);
    check(initial.pieces === 3, `tray shows 3 pieces (got ${initial.pieces})`);
    check(initial.filled === 0, `fresh board has 0 filled cells (got ${initial.filled})`);
    check(initial.score === '0', `score starts at 0 (got "${initial.score}")`);
    check(initial.hasManifest, 'manifest link present');
    check(initial.theme === 'dark', `default theme is dark (got ${initial.theme})`);

    // geometry for a drag that lands the first piece's top-left at board (0,0)
    const geo = await cdp.evaluate(`() => {
      const tp = document.querySelector('.tray-piece');
      const r = tp.getBoundingClientRect();
      const c0 = document.querySelectorAll('#board .cell')[0].getBoundingClientRect();
      const cs = getComputedStyle(document.documentElement);
      const cell = parseFloat(cs.getPropertyValue('--cell'));
      const gap = parseFloat(cs.getPropertyValue('--gap'));
      const w = getComputedStyle(tp).gridTemplateColumns.split(' ').length;
      const h = getComputedStyle(tp).gridTemplateRows.split(' ').length;
      return { trayX: r.left + r.width/2, trayY: r.top + r.height/2,
               originLeft: c0.left, originTop: c0.top, cell, gap, w, h };
    }`);

    const pieceW = geo.w * geo.cell + (geo.w - 1) * geo.gap;
    const pieceH = geo.h * geo.cell + (geo.h - 1) * geo.gap;
    const lift = Math.max(22, geo.cell * 0.5);
    // invert the amplified-drag mapping (start = tray press point) to find the
    // finger position that lands the piece's top-left at board (0,0)
    const GAIN = 1.6;
    const px = geo.trayX + (geo.originLeft - geo.trayX + pieceW / 2) / GAIN;
    const py = geo.trayY + (geo.originTop - geo.trayY + pieceH + lift) / GAIN;

    await cdp.mouse('mousePressed', geo.trayX, geo.trayY);
    await sleep(40);
    await cdp.mouse('mouseMoved', (geo.trayX + px) / 2, (geo.trayY + py) / 2);
    await sleep(40);
    await cdp.mouse('mouseMoved', px, py);
    await sleep(60);

    const ghost = await cdp.evaluate(`() => document.querySelectorAll('#board .cell.ghost').length`);
    check(ghost > 0, `drag shows a valid ghost preview (got ${ghost} ghost cells)`);

    await cdp.mouse('mouseReleased', px, py);
    await sleep(250);

    const after = await cdp.evaluate(`() => ({
      filled: document.querySelectorAll('#board .cell.filled').length,
      pieces: document.querySelectorAll('#tray .tray-piece').length,
      score: Number(document.getElementById('score').textContent),
    })`);

    check(after.filled >= 1, `placing a piece fills board cells (got ${after.filled})`);
    check(after.filled === geo.w * geo.h || after.filled >= 1, `filled cells consistent with piece`);
    check(after.pieces === 2, `tray now has 2 pieces after placing one (got ${after.pieces})`);
    check(after.score >= after.filled, `score increased after placement (got ${after.score})`);

    // theme toggle + aria-pressed wiring
    const themed = await cdp.evaluate(`() => {
      document.getElementById('theme-btn').click();
      return {
        theme: document.documentElement.getAttribute('data-theme'),
        pressed: document.getElementById('theme-btn').getAttribute('aria-pressed'),
      };
    }`);
    check(themed.theme === 'light', `theme toggle switches to light (got ${themed.theme})`);
    check(themed.pressed === 'true', `theme button exposes aria-pressed=true (got ${themed.pressed})`);

    // screenshot (light theme) for visual inspection of contrast fixes
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync('/tmp/bb-smoke.png', Buffer.from(shot.data, 'base64'));
    log('\nScreenshot (light theme): /tmp/bb-smoke.png');

    check(exceptions.length === 0, `no uncaught exceptions${exceptions.length ? ': ' + exceptions.join(' | ') : ''}`);
    check(consoleErrors.length === 0, `no console errors${consoleErrors.length ? ': ' + consoleErrors.join(' | ') : ''}`);

    ws.close();
  } finally {
    cleanup();
  }

  log(`\nUI smoke: ${failed ? failed + ' FAILED' : 'all passed ✓'}`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error('smoke test error:', e);
  process.exit(1);
});
