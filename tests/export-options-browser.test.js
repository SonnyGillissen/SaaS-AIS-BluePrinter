'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');

const browser = ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'].find((file) => fs.existsSync(file));

async function browserChecks() {
  const win = document.querySelector('iframe').contentWindow;
  const A = win.AISBP;
  const doc = win.document;
  const results = [];
  const check = (condition, label) => {
    if (!condition) throw new Error(label);
    results.push(label);
  };
  const closePopup = async (method) => {
    const pending = A.app.actions.exportAs('svg');
    const dialog = doc.querySelector('dialog');
    check(!!dialog, 'SVG action opens options');
    if (method === 'cancel') Array.from(dialog.querySelectorAll('button')).find((b) => b.textContent === 'Cancel').click();
    else if (method === 'close') dialog.querySelector('[aria-label="Close"]').click();
    else dialog.close();
    await pending;
  };
  const downloads = [];
  let iconCalls = 0;
  A.Dom.download = (content, name) => downloads.push({ content, name });
  A.Icons.inlineAll = async () => { iconCalls++; return 0; };
  await new Promise((resolve, reject) => {
    const script = doc.createElement('script');
    script.src = '/js/ui/exporter.js';
    script.onload = resolve;
    script.onerror = reject;
    doc.head.appendChild(script);
  });
  const before = JSON.stringify(A.app.store.project);
  for (const method of ['cancel', 'close', 'programmatic']) await closePopup(method);
  check(downloads.length === 0 && iconCalls === 0, 'Cancellation never downloads or fetches icons');
  const escapePending = A.Dialogs.openExportOptions('png', A.app.store.project);
  const escape = await fetch('/escape');
  check(escape.ok, 'Browser receives real Escape key');
  check(await escapePending === null, 'Escape close resolves null');
  check(downloads.length === 0 && iconCalls === 0, 'Escape never downloads or fetches icons');

  for (const format of ['svg', 'png', 'pdf', 'drawio', 'archimate']) {
    const pending = A.Dialogs.openExportOptions(format, A.app.store.project);
    const dialog = doc.querySelector('dialog');
    check(dialog.textContent.includes('hidden resources'), format + ' hidden-data warning');
    const select = dialog.querySelector('select');
    if (format === 'archimate') check(!select, 'ArchiMate has no unsupported background controls');
    else {
      check(Array.from(select.options).some((o) => o.value === 'transparent') === (format !== 'pdf'), format + ' transparency applicability');
      if (format === 'pdf') check(dialog.textContent.includes('does not support transparency'), 'PDF opacity explanation');
      check(dialog.querySelector('input[type="color"]').getClientRects().length === 0, format + ' picker hidden for style default');
      select.value = 'custom';
      select.dispatchEvent(new win.Event('change'));
      const color = dialog.querySelector('input[type="text"]');
      const picker = dialog.querySelector('input[type="color"]');
      check(!color.disabled && !color.parentElement.hidden, format + ' custom color shown');
      check(picker && !picker.disabled && picker.labels.length === 1 && picker.getClientRects().length > 0, format + ' accessible color picker');
      picker.value = '#abcdef';
      picker.dispatchEvent(new win.Event('input'));
      check(color.value === '#abcdef', format + ' picker synchronizes hex field');
      color.value = '#123AbF';
      color.dispatchEvent(new win.Event('input'));
      check(picker.value === '#123abf', format + ' hex field synchronizes picker');
      if (format === 'svg') {
        color.value = '#bad';
        Array.from(dialog.querySelectorAll('button')).find((b) => b.textContent === 'Export').click();
        await Promise.resolve();
        check(dialog.open, 'Invalid custom color keeps popup open');
      }
      color.value = '#123456';
    }
    Array.from(dialog.querySelectorAll('button')).find((b) => b.textContent === 'Export').click();
    const opts = await pending;
    check(opts.embedDiagram === true && (format === 'archimate' || opts.background === '#123456'), format + ' options accepted');
  }
  check(JSON.stringify(A.app.store.project) === before, 'Popup does not change saved project/settings');

  const project = A.Model.createProject();
  project.settings.diagram.style = 'blueprint';
  for (const background of ['transparent', '#123456']) {
    const rendered = A.Render.renderDocument(project, { background });
    const png = await A.Raster.toPng(rendered.svg, rendered.width, rendered.height, background, { project, embedDiagram: true });
    const bitmap = await win.createImageBitmap(png);
    const canvas = doc.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0);
    const pixel = Array.from(ctx.getImageData(1, 1, 1, 1).data);
    check(JSON.stringify(pixel) === JSON.stringify(background === 'transparent' ? [0, 0, 0, 0] : [18, 52, 86, 255]), 'PNG pixel ' + background + ': ' + pixel);
    check((await A.Embedded.fromFile(png)).project.settings.diagram.style === 'blueprint', 'Real PNG embedded roundtrip ' + background);
    bitmap.close();
  }
  const rendered = A.Render.renderDocument(project, { background: '#123456' });
  const pdf = await A.Raster.toPdf(rendered.svg, rendered.width, rendered.height, { pageSize: 'A4', background: '#123456', project, embedDiagram: true });
  const text = new TextDecoder('latin1').decode(await pdf.arrayBuffer());
  check(text.includes('0.070588 0.203922 0.337255 rg 0 0 841.89 595.28 re f'), 'Real PDF paints full page margins');
  check((await A.Embedded.fromFile(pdf)).project.settings.diagram.style === 'blueprint', 'Real PDF embedded roundtrip');

  win.AISBP_CONFIG.exports.embedDiagram = false;
  const pending = A.app.actions.exportAs('svg');
  const dialog = doc.querySelector('dialog');
  const embed = dialog.querySelector('input[type="checkbox"]');
  check(embed.checked === false, 'Popup uses false deployment default');
  embed.checked = true;
  A.app.store.project.meta.name = 'Changed while popup is open';
  Array.from(dialog.querySelectorAll('button')).find((b) => b.textContent === 'Export').click();
  await pending;
  const svg = downloads.pop().content;
  check((await A.Embedded.fromFile(new Blob([svg]))).project.meta.name === JSON.parse(before).meta.name, 'Action snapshots project at launch and true overrides global false');
  for (const embedDiagram of [true, false]) {
    win.AISBP_CONFIG.exports.embedDiagram = !embedDiagram;
    for (const format of ['svg', 'png', 'pdf', 'drawio', 'archimate']) {
      const opts = { embedDiagram };
      if (format !== 'archimate') opts.background = '#123456';
      await A.Exporter.run(format, project, opts);
      const content = downloads.pop().content;
      const file = content instanceof win.Blob ? content : new Blob([content]);
      if (embedDiagram) check((await A.Embedded.fromFile(file)).project.settings.diagram.style === 'blueprint', format + ' API true overrides false default');
      else {
        let rejected = false;
        try { await A.Embedded.fromFile(file); } catch (e) { rejected = e.message.includes('no embedded'); }
        check(rejected, format + ' API false overrides true default');
      }
    }
  }
  await A.app.actions.exportAs('json');
  check(!doc.querySelector('dialog') && downloads.pop().name.endsWith('.aisbp.json'), 'JSON downloads directly');

  // Exercise routing gestures in the real SVG canvas, including zoomed coordinates.
  const routeProject = A.Model.createProject();
  const from = A.Model.addNode(routeProject, 'external-system', null, { x: 0, y: 0 });
  const to = A.Model.addNode(routeProject, 'external-system', null, { x: 500, y: 200 });
  const conn = A.Model.addConnection(routeProject, from.id, to.id);
  const store = A.app.store;
  const canvas = A.app.canvas;
  store.load(routeProject);
  store.select([], [conn.id]);
  canvas.zoomIn();
  canvas.render();
  const svgCanvas = doc.getElementById('canvas-svg');
  // Synthetic PointerEvents do not have an active native pointer to capture.
  svgCanvas.setPointerCapture = () => {};
  svgCanvas.releasePointerCapture = () => {};
  const fire = (target, type, x, y) => target.dispatchEvent(new win.PointerEvent(type, { bubbles: true, pointerId: 1, button: 0, clientX: x, clientY: y }));
  const dragPoint = (insert, endType = 'pointerup') => {
    const handle = doc.querySelector('[data-handle="route"][data-insert="' + insert + '"]');
    check(!!handle, 'Routing handle exists: ' + insert);
    const r = handle.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    fire(handle, 'pointerdown', x, y);
    fire(svgCanvas, 'pointermove', x + 72, y + 96);
    if (endType === 'Escape') doc.getElementById('canvas').dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    else fire(svgCanvas, endType, x + 72, y + 96);
    canvas.render();
  };
  dragPoint(true);
  check(store.project.connections[conn.id].waypoints.length === 1 && store.past.length === 1, 'Dragging adds a persisted point in one undo step');
  const routeBefore = JSON.stringify(store.project.connections[conn.id].waypoints);
  dragPoint(false);
  check(JSON.stringify(store.project.connections[conn.id].waypoints) !== routeBefore && store.past.length === 2, 'Existing routing point can be redragged');
  store.undo();
  check(JSON.stringify(store.project.connections[conn.id].waypoints) === routeBefore, 'Undo restores routing point');
  store.redo();
  canvas.render();
  const cancelBefore = JSON.stringify(store.project.connections[conn.id].waypoints);
  dragPoint(false, 'pointercancel');
  check(JSON.stringify(store.project.connections[conn.id].waypoints) === cancelBefore && store.past.length === 2, 'Pointer cancellation rolls routing back');
  dragPoint(false, 'Escape');
  check(JSON.stringify(store.project.connections[conn.id].waypoints) === cancelBefore && store.past.length === 2, 'Escape cancels routing without a history entry');
  dragPoint(true);
  check(store.project.connections[conn.id].waypoints.length === 2, 'Another segment handle adds a second point');
  const pointHandle = doc.querySelector('[data-handle="route"][data-insert="false"]');
  pointHandle.dispatchEvent(new win.MouseEvent('dblclick', { bubbles: true }));
  check(store.project.connections[conn.id].waypoints.length === 1, 'Double click removes a routing point');
  const reset = Array.from(doc.querySelectorAll('button')).find((b) => b.textContent === 'Reset route');
  check(reset && !reset.disabled, 'Connection properties offer route reset');
  reset.click();
  check(store.project.connections[conn.id].waypoints.length === 0, 'Reset restores automatic routing');
  store.undo();
  check(store.project.connections[conn.id].waypoints.length === 1, 'Route reset can be undone');
  return results;
}

test('real browser export dialogs, raster alpha and PDF margins', { skip: !browser || typeof WebSocket === 'undefined', timeout: 45000 }, async () => {
  const root = path.join(__dirname, '..');
  const profile = path.join(root, '.export-options-browser-profile-' + process.pid);
  fs.mkdirSync(profile);
  const html = '<!doctype html><body><pre id="result">pending</pre><iframe src="/index.html"></iframe><script>' +
    'document.querySelector("iframe").onload = async () => { try { const results = await (' + browserChecks.toString() +
    ')(); document.getElementById("result").textContent = "PASS " + JSON.stringify(results); } catch (e) { document.getElementById("result").textContent = "FAIL " + e.stack; }' +
    'fetch("/result", {method: "POST", body: document.getElementById("result").textContent}); };</script>';
  let report;
  const completed = new Promise((resolve) => { report = resolve; });
  const server = http.createServer((req, res) => {
    if (req.url === '/escape') {
      (async () => {
        const port = fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0];
        const targets = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
        const target = targets.find((item) => item.type === 'page');
        const socket = new WebSocket(target.webSocketDebuggerUrl);
        try {
          await new Promise((resolve, reject) => {
            socket.addEventListener('open', resolve, { once: true });
            socket.addEventListener('error', reject, { once: true });
          });
          await new Promise((resolve, reject) => {
            socket.addEventListener('message', (event) => {
              const message = JSON.parse(event.data);
              if (message.id === 1) message.error ? reject(new Error(message.error.message)) : resolve();
            });
            socket.send(JSON.stringify({ id: 1, method: 'Input.dispatchKeyEvent', params: { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 } }));
          });
          socket.send(JSON.stringify({ id: 2, method: 'Input.dispatchKeyEvent', params: { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 } }));
          res.end();
        } finally { socket.close(); }
      })().catch((error) => { res.writeHead(500); res.end(error.message); });
      return;
    }
    if (req.url === '/result') {
      let text = '';
      req.on('data', (data) => { text += data; });
      req.on('end', () => { res.end(); report(text); });
      return;
    }
    if (req.url === '/checks') { res.setHeader('Content-Type', 'text/html'); res.end(html); return; }
    const file = path.resolve(root, '.' + decodeURIComponent(req.url.split('?')[0]));
    if (!file.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
    fs.readFile(file, (error, bytes) => {
      if (error) { res.writeHead(404); res.end(); return; }
      const types = { '.js': 'application/javascript', '.html': 'text/html', '.css': 'text/css' };
      res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
      res.end(bytes);
    });
  });
  let child;
  let timer;
  let stderr = '';
  try {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    child = spawn(browser, [
      '--headless', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu',
      '--user-data-dir=' + profile, '--remote-debugging-port=0',
      'http://127.0.0.1:' + server.address().port + '/checks'
    ]);
    child.stderr.on('data', (data) => { stderr += data; });
    child.on('error', (error) => report('FAIL ' + error.message));
    timer = setTimeout(() => report('FAIL Browser checks timed out\n' + stderr), 25000);
    const result = await completed;
    assert.match(result, /^PASS /, result);
    assert.ok(result.includes('PNG pixel transparent: 0,0,0,0'));
  } finally {
    clearTimeout(timer);
    if (child && child.exitCode === null) {
      child.kill();
      await new Promise((resolve) => child.once('close', resolve));
    }
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await fs.promises.rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
