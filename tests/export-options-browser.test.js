'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { spawn } = require('node:child_process');

const browser = ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'].find((file) => fs.existsSync(file));

async function browserChecks() {
  const win = document.querySelector('iframe').contentWindow;
  const A = win.AISBP;
  const doc = win.document;
  const annotationFrame = document.querySelector('iframe');
  annotationFrame.style.cssText = 'width:760px;height:550px';
  const pause = () => new Promise((resolve) => win.setTimeout(resolve, 30));
  const annotationEvents = [];
  win.addEventListener('error', (e) => annotationEvents.push(e.message));
  for (const type of ['pointerdown', 'pointerup', 'dblclick']) doc.getElementById('canvas-svg').addEventListener(type, (e) => annotationEvents.push([type, e.target.tagName, e.clientX, e.clientY]));
  const results = [];
  const check = (condition, label) => {
    if (!condition) throw new Error(label);
    results.push(label);
  };
  const annotationsBefore = A.Util.clone(A.app.store.project);
  const clickText = (text) => {
    const button = Array.from(doc.querySelectorAll('dialog[open] button, .annotation-inline-editor button, #panel-properties button')).find((b) => b.textContent === text);
    check(!!button, 'Annotation control exists: ' + text);
    button.click();
  };
  const change = (id, value, event) => {
    const input = doc.getElementById(id);
    input.value = value;
    input.dispatchEvent(new win.Event(event || 'change'));
  };
  const key = (target, name, modifiers) => target.dispatchEvent(new win.KeyboardEvent('keydown', Object.assign({ key: name, bubbles: true, cancelable: true }, modifiers)));
  async function doubleClickAnnotation(id) {
    A.app.canvas.fit();
    A.app.canvas.render();
    await pause();
    const box = doc.querySelector('#content [data-node-id="' + id + '"]').getBoundingClientRect();
    const frameBox = annotationFrame.getBoundingClientRect();
    const response = await fetch('/canvas-double-click?x=' + (frameBox.left + 2 + box.left + box.width / 2) + '&y=' + (frameBox.top + 2 + box.top + Math.min(15, box.height / 2)));
    check(response.ok, 'Native canvas double-click dispatched');
  }
  check(doc.querySelectorAll('[data-type^="annotation-"]').length === 3, 'Palette exposes Text, Markdown and Table annotations');
  const paletteGroups = Array.from(doc.querySelectorAll('#panel-palette .palette-group > summary'));
  check(paletteGroups[0].textContent.startsWith('Hierarchy (') && paletteGroups[paletteGroups.length - 2].textContent.startsWith('Other (') && paletteGroups[paletteGroups.length - 1].textContent.startsWith('Text & Tables ('), 'Actual palette puts Azure hierarchy first and Text & Tables last, after Other');
  A.app.actions.addAuto('annotation-markdown');
  const markdownId = A.app.store.singleNode().id;
  change('prop-annotation-content', '# Browser heading\n**Bold** and *italic*\n<script>unsafe<' + '/script>', 'input');
  change('prop-annotation-theme', 'callout');
  A.app.canvas.render();
  check(!doc.getElementById('prop-name-mode') && !doc.getElementById('prop-label'), 'Annotation properties omit Azure naming fields');
  const annotation = doc.querySelector('#content [data-node-id="' + markdownId + '"]');
  check(annotation && annotation.querySelector('text') && !annotation.querySelector('textarea,input,foreignObject,script'), 'Markdown canvas is safe rendered SVG text, never an input');
  check(!!doc.querySelector('#overlay [data-handle="resize"][data-node-id="' + markdownId + '"]'), 'Annotations expose a canvas resize handle');
  const originalMarkdown = A.app.store.project.nodes[markdownId].attributes.content;
  const markdownHistory = A.app.store.past.length;
  await doubleClickAnnotation(markdownId);
  let inline = doc.querySelector('.annotation-inline-editor');
  check(!!inline && !doc.querySelector('dialog'), 'Native Markdown double-click opens an actual canvas inline editor: ' + JSON.stringify(annotationEvents));
  let editor = doc.getElementById('annotation-editor-content');
  check(editor.value === originalMarkdown && doc.activeElement === editor, 'Inline editor preserves and focuses original Markdown');
  check(!inline.querySelector('script,img,a,iframe,object') && inline.querySelector('.markdown-preview').textContent.includes('<script>unsafe'), 'Markdown preview renders injection as inert text');
  const editorBox = inline.getBoundingClientRect();
  const canvasBox = doc.getElementById('canvas-svg').getBoundingClientRect();
  check(editorBox.left >= canvasBox.left && editorBox.right <= canvasBox.right + 1 && editorBox.bottom <= canvasBox.bottom + 1, 'Inline editor stays inside actual small canvas viewport and scrolls');
  const originalFrameHeight = annotationFrame.style.height;
  annotationFrame.style.height = '1400px';
  const previewDetails = inline.querySelector('details');
  previewDetails.open = false;
  await pause();
  const roomyCanvas = doc.getElementById('canvas-svg').getBoundingClientRect();
  const anchor = A.app.canvas.annotationBounds(markdownId);
  doc.getElementById('canvas-svg').dispatchEvent(new win.WheelEvent('wheel', { deltaY: anchor.top - (roomyCanvas.bottom - 25), cancelable: true }));
  const collapsedTop = inline.getBoundingClientRect().top;
  previewDetails.open = true;
  await pause();
  check(inline.getBoundingClientRect().top < collapsedTop && inline.getBoundingClientRect().bottom <= roomyCanvas.bottom + 1, 'Expanding preview near canvas bottom reclamps editor rather than pushing controls offscreen');
  previewDetails.open = false;
  await pause();
  const resizeTop = inline.getBoundingClientRect().top;
  editor.style.height = '230px';
  await pause();
  const editorActions = Array.from(inline.querySelectorAll('button')).filter((button) => ['Save', 'Cancel'].includes(button.textContent));
  check(inline.getBoundingClientRect().top < resizeTop && editorActions.every((button) => button.getBoundingClientRect().bottom <= roomyCanvas.bottom + 1), 'Resizing textarea near canvas bottom keeps Save and Cancel inside viewport');
  editor.style.height = '';
  previewDetails.open = true;
  annotationFrame.style.height = originalFrameHeight;
  await pause();
  editor.setSelectionRange(0, 0);
  clickText('Bold');
  check(editor.value.startsWith('****') && A.app.store.past.length === markdownHistory, 'Toolbar generates Markdown without modifying saved content or history');
  key(editor, 'a', { ctrlKey: true });
  key(editor, 'z', { ctrlKey: true });
  key(editor, 'Delete');
  check(A.app.store.selection.nodes.has(markdownId) && A.app.store.past.length === markdownHistory && !!A.app.store.project.nodes[markdownId], 'Editor text shortcuts do not select, undo or delete canvas objects');
  const toolbarButton = inline.querySelector('.markdown-toolbar button');
  const toolbarProject = JSON.stringify(A.app.store.project);
  toolbarButton.focus();
  for (const name of ['Delete', 'Backspace', 'ArrowRight', 'ArrowDown']) key(toolbarButton, name);
  for (const name of ['a', 'z', 'y', 'd']) key(toolbarButton, name, { ctrlKey: true });
  for (const name of ['copy', 'cut', 'paste']) {
    const clipboardEvent = new win.ClipboardEvent(name, { bubbles: true, cancelable: true, clipboardData: new win.DataTransfer() });
    toolbarButton.dispatchEvent(clipboardEvent);
    check(!clipboardEvent.defaultPrevented, 'Focused inline toolbar does not hijack native clipboard: ' + name);
  }
  check(JSON.stringify(A.app.store.project) === toolbarProject && A.app.store.past.length === markdownHistory && A.app.store.selection.nodes.has(markdownId), 'Focused inline toolbar cannot leak delete, nudge, select, duplicate or history shortcuts to canvas');
  A.app.canvas.zoomIn();
  const zoomedEditor = inline.getBoundingClientRect();
  check(zoomedEditor.left >= canvasBox.left && zoomedEditor.right <= canvasBox.right + 1, 'Inline overlay tracks view changes');
  key(editor, 'Escape');
  check(!doc.querySelector('.annotation-inline-editor') && A.app.store.project.nodes[markdownId].attributes.content === originalMarkdown && A.app.store.selection.nodes.has(markdownId), 'Inline Escape cancels without changing content or selection');
  doc.getElementById('prop-edit-annotation').focus();
  clickText('Edit on canvas');
  editor = doc.getElementById('annotation-editor-content');
  change('annotation-editor-content', 'Heading\nbold\nitalic\nbullet\nnumber\ncode\nquote', 'input');
  const formatLines = [['Heading 2', 'Heading'], ['Bold', 'bold'], ['Italic', 'italic'], ['Bulleted list', 'bullet'], ['Numbered list', 'number'], ['Code', 'code'], ['Quote', 'quote']];
  for (const [button, text] of formatLines) {
    const start = editor.value.indexOf(text);
    editor.setSelectionRange(start, start + text.length);
    clickText(button);
  }
  const formatted = editor.value;
  check(formatted.includes('## Heading') && formatted.includes('**bold**') && formatted.includes('*italic*') && formatted.includes('- bullet') && formatted.includes('1. number') && formatted.includes('`code`') && formatted.includes('> quote'), 'Markdown toolbar supports headings, bold, italic, lists, code and quotes');
  key(editor, 'Enter', { metaKey: true });
  check(A.app.store.project.nodes[markdownId].attributes.content === formatted && A.app.store.past.length === markdownHistory + 1, 'Cmd+Enter persists Markdown in one undo step');
  check(doc.activeElement.id === 'prop-edit-annotation', 'Saving restores focus to recreated Properties edit button');
  A.app.store.undo();
  check(A.app.store.project.nodes[markdownId].attributes.content === originalMarkdown, 'Markdown undo restores complete original content');
  A.app.store.redo();
  check(A.app.store.project.nodes[markdownId].attributes.content === formatted, 'Markdown redo restores formatting');
  clickText('Edit on canvas');
  change('annotation-editor-content', 'x'.repeat(20001), 'input');
  clickText('Save');
  check(!!doc.querySelector('.annotation-inline-editor') && A.app.store.project.nodes[markdownId].attributes.content === formatted, 'Oversized inline content is rejected, never silently truncated');
  clickText('Cancel');
  A.app.actions.addAuto('annotation-text');
  const plainId = A.app.store.singleNode().id;
  await doubleClickAnnotation(plainId);
  check(!doc.querySelector('.markdown-toolbar') && doc.getElementById('annotation-editor-content'), 'Plain Text double-click opens simple textarea without Markdown toolbar');
  const plainBefore = A.app.store.project.nodes[plainId].attributes.content;
  change('annotation-editor-content', 'Plain\n**literal** <img src=x onerror=alert(1)>', 'input');
  key(doc.getElementById('annotation-editor-content'), 'Enter', { ctrlKey: true });
  check(A.app.store.project.nodes[plainId].attributes.content.includes('**literal**'), 'Ctrl+Enter preserves literal plain text');
  A.app.store.undo();
  check(A.app.store.project.nodes[plainId].attributes.content === plainBefore, 'Plain editor save supports undo');
  A.app.store.redo();
  clickText('Edit on canvas');
  change('annotation-editor-content', 'discard on project change', 'input');
  A.app.store.change('move annotation while editing', (p) => A.Model.moveNodes(p, [plainId], 10, 0));
  check(!doc.querySelector('.annotation-inline-editor') && A.app.store.project.nodes[plainId].attributes.content.includes('**literal**'), 'Project/position changes cancel isolated drafts instead of saving stale content');
  A.app.actions.addAuto('annotation-table');
  const tableId = A.app.store.singleNode().id;
  A.app.store.change('manual table dimensions', (p) => A.Model.updateNode(p, tableId, { w: 640, h: 320 }));
  const tableBefore = JSON.stringify(A.app.store.project);
  const tableHistory = A.app.store.past.length;
  check(!doc.getElementById('prop-cell-0-0') && !doc.getElementById('prop-annotation-theme'), 'Properties replaces all table adjustment controls with shared edit button');
  await doubleClickAnnotation(tableId);
  check(!!doc.querySelector('dialog.annotation-table-dialog[open]'), 'Native table double-click opens roomy table dialog');
  change('prop-cell-1-0', 'Editable\nmultiline', 'input');
  change('prop-column-width-0', '220', 'input');
  change('prop-annotation-caption', 'Draft caption', 'input');
  change('prop-annotation-theme', 'card');
  change('prop-annotation-align', 'center');
  change('prop-annotation-fontSize', '18', 'input');
  change('prop-annotation-padding', '9', 'input');
  change('prop-annotation-grid', 'rows');
  doc.getElementById('prop-annotation-striped').click();
  doc.getElementById('prop-annotation-firstColumnHeader').click();
  check(JSON.stringify(A.app.store.project) === tableBefore && A.app.store.past.length === tableHistory, 'Table content and every adjustment stay isolated until Save');
  clickText('Add row');
  clickText('Add column');
  check(doc.getElementById('prop-cell-2-2') && doc.getElementById('prop-cell-1-0').value === 'Editable\nmultiline', 'Multiple row/column operations preserve latest multiline draft');
  doc.querySelector('[aria-label="Move column 1 right"]').click();
  check(doc.getElementById('prop-column-width-1').value === '220', 'Reordering draft columns carries widths');
  doc.querySelector('[aria-label="Move row 2 down"]').click();
  check(doc.getElementById('prop-cell-2-1').value === 'Editable\nmultiline', 'Draft rows can be reordered without stale cell data');
  doc.querySelector('[aria-label="Remove column 3"]').click();
  doc.querySelector('[aria-label="Remove row 2"]').click();
  key(doc.getElementById('prop-cell-1-1'), 'z', { ctrlKey: true });
  check(A.app.store.past.length === tableHistory, 'Table Ctrl+Z remains native editor text undo, not project history');
  key(doc.getElementById('prop-cell-1-1'), 'Enter', { ctrlKey: true });
  await pause();
  let savedTable = A.app.store.project.nodes[tableId].attributes;
  check(A.Annotations.rows(savedTable.rows).length === 2 && A.Annotations.rows(savedTable.rows)[0].length === 2 && A.Annotations.rows(savedTable.rows)[1][1] === 'Editable\nmultiline', 'Draft row/column removal and cell content save together');
  check(savedTable.caption === 'Draft caption' && savedTable.theme === 'card' && savedTable.align === 'center' && savedTable.fontSize === 18 && savedTable.padding === 9 && savedTable.grid === 'rows' && savedTable.striped && savedTable.firstColumnHeader, 'All table appearance adjustments persist from shared popup');
  check(A.app.store.project.nodes[tableId].w === 640 && A.app.store.project.nodes[tableId].h === 320, 'Table save preserves manual dimensions unless reset is explicitly checked');
  check(A.app.store.past.length === tableHistory + 1, 'Entire table dialog save is exactly one undo step');
  A.app.store.undo();
  check(JSON.stringify(A.app.store.project) === tableBefore, 'Table undo restores original contents and all adjustments');
  A.app.store.redo();
  const tableSaved = JSON.stringify(A.app.store.project);
  for (const method of ['Cancel', 'Escape', 'Close']) {
    doc.getElementById('prop-edit-annotation').focus();
    clickText('Edit Table');
    check(!!doc.querySelector('dialog.annotation-table-dialog[open]'), 'Properties opens same shared table popup: ' + method);
    change('prop-cell-1-0', 'Discard this', 'input');
    doc.getElementById('annotation-table-reset-size').click();
    clickText('Add row');
    if (method === 'Escape') await fetch('/escape');
    else if (method === 'Close') doc.querySelector('dialog[open] [aria-label="Close"]').click();
    else clickText('Cancel');
    await pause();
    check(JSON.stringify(A.app.store.project) === tableSaved && !doc.querySelector('dialog'), 'Table ' + method + ' discards content and operations');
    check(doc.activeElement.id === 'prop-edit-annotation', 'Table ' + method + ' restores Properties button focus');
  }
  clickText('Edit Table');
  clickText('Add row');
  change('prop-cell-1-0', 'zebra', 'input');
  change('prop-cell-2-0', 'apple', 'input');
  doc.querySelector('[aria-label="Sort column 1 ascending"]').click();
  check(doc.getElementById('prop-cell-1-0').value === 'apple' && doc.getElementById('prop-cell-0-0').value === 'Value', 'Sorting uses latest draft and preserves header row');
  change('prop-cell-1-0', 'x'.repeat(1001), 'input');
  clickText('Save');
  await pause();
  check(!!doc.querySelector('dialog[open]') && JSON.stringify(A.app.store.project) === tableSaved, 'Oversized cells block save without truncation');
  clickText('Cancel');
  await pause();
  const resetBefore = JSON.stringify(A.app.store.project);
  const resetHistory = A.app.store.past.length;
  clickText('Edit Table');
  doc.getElementById('annotation-table-reset-size').click();
  clickText('Save');
  await pause();
  check(A.app.store.project.nodes[tableId].w === undefined && A.app.store.project.nodes[tableId].h === undefined && A.app.store.past.length === resetHistory + 1, 'Reset size on save removes both manual dimensions in the shared table save');
  A.app.store.undo();
  check(JSON.stringify(A.app.store.project) === resetBefore, 'Undo restores both table dimensions after popup size reset');
  A.app.store.change('check Blueprint wrapping', (p) => {
    p.settings.diagram.style = 'blueprint';
    A.Model.updateNode(p, markdownId, { attributes: { content: 'ill '.repeat(15) } });
  });
  A.app.canvas.render();
  const blueprintText = Array.from(doc.querySelectorAll('#content [data-node-id="' + markdownId + '"] text'));
  check(blueprintText.length > 1 && blueprintText.every((text) => text.getComputedTextLength() <= 276), 'Blueprint annotation wrapping fits actual monospace glyph widths');
  const annotationSvg = A.Render.renderDocument(A.app.store.project);
  const annotationPng = await A.Raster.toPng(annotationSvg.svg, annotationSvg.width, annotationSvg.height, '#ffffff');
  const annotationPdf = await A.Raster.toPdf(annotationSvg.svg, annotationSvg.width, annotationSvg.height, { pageSize: 'A4' });
  check(annotationPng.type === 'image/png' && annotationPng.size > 100, 'Rendered annotations export to PNG');
  check(annotationPdf.type === 'application/pdf' && annotationPdf.size > 100, 'Rendered annotations export to PDF');
  A.app.store.load(annotationsBefore);
  const namingBefore = JSON.stringify(A.app.store.project);
  A.Dialogs.openOptions(A.app, 'types');
  const options = doc.querySelector('dialog');
  const namingTable = options.querySelector('table.naming-types');
  const storagePattern = namingTable.querySelector('input[aria-label="Storage Account pattern"]');
  const ruleButton = namingTable.querySelector('button[aria-label="Azure naming rule for Storage Account"]');
  const fullRule = A.Naming.describeRule(A.Catalog.get('storage-account').rule);
  check(storagePattern.getBoundingClientRect().width > 300, 'Naming pattern has a wide editing column');
  check(storagePattern.closest('td').getBoundingClientRect().width > ruleButton.closest('td').getBoundingClientRect().width * 2, 'Naming pattern column is wider than compact Azure rule column');
  check(ruleButton.textContent === '3\u201324 chars \u24d8' && ruleButton.title === fullRule, 'Compact Azure rule includes complete hover tooltip');
  check(ruleButton.getAttribute('aria-haspopup') === 'dialog', 'Azure rule exposes accessible popup semantics');
  check(namingTable.querySelectorAll('tbody tr').length === A.Catalog.all().filter((d) => d.rule).length, 'All resource types retain naming controls');
  ruleButton.focus();
  ruleButton.click();
  const ruleDialog = Array.from(doc.querySelectorAll('dialog')).find((d) => d !== options);
  check(ruleDialog.open && ruleDialog.getAttribute('aria-label').includes('Storage Account'), 'Azure rule opens resource-specific popup');
  check(Array.from(ruleDialog.querySelectorAll('li')).map((li) => li.textContent).join('; ') === fullRule, 'Azure rule popup preserves every restriction');
  ruleDialog.close();
  await new Promise((resolve) => win.setTimeout(resolve, 30));
  check(options.open && doc.activeElement === ruleButton, 'Closing rule popup returns focus to naming options');
  const frame = document.querySelector('iframe');
  const originalWidth = frame.style.width;
  frame.style.width = '480px';
  check(namingTable.parentElement.scrollWidth > namingTable.parentElement.clientWidth && storagePattern.getBoundingClientRect().width > 300, 'Narrow naming table scrolls without shrinking pattern input');
  frame.style.width = originalWidth;
  storagePattern.value = '{abbr}-{name}-{instance}';
  storagePattern.dispatchEvent(new win.Event('input'));
  Array.from(options.querySelectorAll('button')).find((b) => b.textContent === 'Cancel').click();
  await new Promise((resolve) => win.setTimeout(resolve, 30));
  check(JSON.stringify(A.app.store.project) === namingBefore, 'Naming layout and rule popup preserve cancel behavior');
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
  const from = A.Model.addNode(routeProject, 'subscription', null, { x: 0, y: 0 });
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
  const currentRoute = () => {
    const c = store.project.connections[conn.id];
    const g = store.derived().geometry;
    return A.Render.connectorPath(g.rects[c.from], g.rects[c.to], store.project.settings.diagram.connector, c.waypoints, c.sourceAnchor, c.targetAnchor);
  };
  const automatic = currentRoute();
  const unedited = JSON.stringify(store.project.connections[conn.id]);
  const anchorHandle = doc.querySelector('[data-handle="anchor"][data-endpoint="target"]');
  const untouched = anchorHandle.getBoundingClientRect();
  fire(anchorHandle, 'pointerdown', untouched.left + untouched.width / 2, untouched.top + untouched.height / 2);
  fire(svgCanvas, 'pointerup', untouched.left + untouched.width / 2, untouched.top + untouched.height / 2);
  check(JSON.stringify(store.project.connections[conn.id]) === unedited && store.past.length === 0, 'Selecting endpoint without dragging keeps automatic anchors and history');
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
  check(!!store.project.connections[conn.id].sourceAnchor && !!store.project.connections[conn.id].targetAnchor, 'First route drag captures both attachments');
  check(JSON.stringify(currentRoute().start) === JSON.stringify(automatic.start) && JSON.stringify(currentRoute().end) === JSON.stringify(automatic.end), 'First waypoint edit fixes existing arrow and source positions');
  store.undo();
  check(JSON.stringify(store.project.connections[conn.id]) === unedited, 'First drag undo also restores automatic anchors');
  store.redo();
  canvas.render();
  const routeBefore = JSON.stringify(store.project.connections[conn.id].waypoints);
  dragPoint(false);
  check(JSON.stringify(store.project.connections[conn.id].waypoints) !== routeBefore && store.past.length === 2, 'Existing routing point can be redragged');
  check(JSON.stringify(currentRoute().end) === JSON.stringify(automatic.end), 'Moving a waypoint cannot move the anchored arrow');
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
  const dragEndpoint = (endpoint, nodeId, point, endType = 'pointerup') => {
    canvas.render();
    const handle = doc.querySelector('[data-handle="anchor"][data-endpoint="' + endpoint + '"]');
    check(!!handle, endpoint + ' endpoint handle is visible');
    const box = handle.getBoundingClientRect();
    const p = svgCanvas.createSVGPoint();
    p.x = point.x; p.y = point.y;
    const client = p.matrixTransform(doc.getElementById('viewport').getScreenCTM());
    fire(handle, 'pointerdown', box.left + box.width / 2, box.top + box.height / 2);
    fire(svgCanvas, 'pointermove', client.x, client.y);
    if (endType === 'Escape') doc.getElementById('canvas').dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    else fire(svgCanvas, endType, client.x, client.y);
    canvas.render();
    check(store.project.connections[conn.id][endpoint === 'source' ? 'from' : 'to'] === nodeId, endpoint + ' endpoint never reconnects');
  };
  const endpointBefore = JSON.stringify(store.project.connections[conn.id]);
  const endpointHistory = store.past.length;
  const targetRect = store.derived().geometry.rects[to.id];
  const desiredTarget = { x: targetRect.x - 30, y: targetRect.y + targetRect.h * 0.6 };
  dragEndpoint('target', to.id, desiredTarget);
  const targetAnchor = store.project.connections[conn.id].targetAnchor;
  check(targetAnchor.side === 'left' && Math.abs(targetAnchor.offset - 0.6) < 1e-6 && store.past.length === endpointHistory + 1, 'Arrow handle snaps to nearest own edge in one undo step at zoom');
  check(JSON.stringify(store.project.connections[conn.id].waypoints) === JSON.stringify(JSON.parse(endpointBefore).waypoints), 'Arrow drag preserves routing points');
  store.undo();
  check(JSON.stringify(store.project.connections[conn.id]) === endpointBefore, 'Endpoint undo restores entire connection');
  store.redo();
  canvas.render();
  const sourceRect = store.derived().geometry.rects[from.id];
  const desiredSource = { x: sourceRect.x + sourceRect.w * 0.3, y: sourceRect.y - 40 };
  dragEndpoint('source', from.id, desiredSource);
  check(store.project.connections[conn.id].sourceAnchor.side === 'top' && Math.abs(store.project.connections[conn.id].sourceAnchor.offset - 0.3) < 1e-6, 'Source endpoint is draggable too');
  const stable = JSON.stringify(store.project.connections[conn.id]);
  const stableHistory = store.past.length;
  for (const endType of ['pointercancel', 'Escape']) {
    dragEndpoint('target', to.id, { x: sourceRect.x, y: sourceRect.y }, endType);
    check(JSON.stringify(store.project.connections[conn.id]) === stable && store.past.length === stableHistory, endType + ' rolls back endpoint anchors with no history entry');
  }
  const movedArrow = currentRoute().end;
  store.change('move node', (p) => A.Model.moveNodes(p, [to.id], 40, 60));
  check(Math.abs(currentRoute().end.x - movedArrow.x - 40) < 1e-6 && Math.abs(currentRoute().end.y - movedArrow.y - 60) < 1e-6, 'Arrow attachment follows moved node');
  store.undo();
  canvas.render();
  store.select([from.id]);
  canvas.render();
  const grip = doc.querySelector('[data-handle="resize"]');
  check(!!grip, 'Source container has a resize handle');
  const gripRect = grip.getBoundingClientRect();
  const gx = gripRect.left + gripRect.width / 2;
  const gy = gripRect.top + gripRect.height / 2;
  const resizeHistory = store.past.length;
  const oldSource = currentRoute().start;
  fire(grip, 'pointerdown', gx, gy);
  fire(svgCanvas, 'pointermove', gx + 100, gy + 80);
  fire(svgCanvas, 'pointerup', gx + 100, gy + 80);
  canvas.render();
  const resizedSource = store.derived().geometry.rects[from.id];
  const expectedSource = A.Render.anchorPoint(resizedSource, store.project.connections[conn.id].sourceAnchor);
  check(JSON.stringify(currentRoute().start) === JSON.stringify(expectedSource) && currentRoute().start.x !== oldSource.x && store.past.length === resizeHistory + 1, 'Real resize gesture retains relative source attachment in one undo step');
  store.undo();
  store.select([], [conn.id]);
  canvas.render();
  // Native capture retargets dblclick to the SVG rather than its handle.
  delete svgCanvas.setPointerCapture;
  delete svgCanvas.releasePointerCapture;
  document.querySelector('iframe').style.cssText = 'width:760px;height:450px';
  await new Promise((resolve) => win.requestAnimationFrame(resolve));
  canvas.fit();
  canvas.render();
  await new Promise((resolve) => win.requestAnimationFrame(() => win.requestAnimationFrame(resolve)));
  const pointHandle = doc.querySelector('[data-handle="route"][data-insert="false"]');
  const pointRect = pointHandle.getBoundingClientRect();
  const frameRect = document.querySelector('iframe').getBoundingClientRect();
  const clickEvents = [];
  for (const type of ['pointerdown', 'pointerup', 'dblclick']) svgCanvas.addEventListener(type, (e) => clickEvents.push([type, e.target.tagName, e.clientX, e.clientY]));
  const nativeClick = await fetch('/route-double-click?x=' + (frameRect.left + 2 + pointRect.left + pointRect.width / 2) + '&y=' + (frameRect.top + 2 + pointRect.top + pointRect.height / 2));
  check(nativeClick.ok && store.project.connections[conn.id].waypoints.length === 1, 'Native double click removes a routing point: ' + JSON.stringify({ clickEvents, pointRect, frameRect, points: store.project.connections[conn.id].waypoints }));
  const reset = Array.from(doc.querySelectorAll('button')).find((b) => b.textContent === 'Reset route');
  check(reset && !reset.disabled, 'Connection properties offer route reset');
  reset.click();
  check(store.project.connections[conn.id].waypoints.length === 0 && !!store.project.connections[conn.id].targetAnchor, 'Route reset removes points but preserves anchored arrow');
  store.undo();
  check(store.project.connections[conn.id].waypoints.length === 1, 'Route reset can be undone');
  canvas.render();
  const beforeReverse = JSON.parse(JSON.stringify(store.project.connections[conn.id]));
  const reverse = Array.from(doc.querySelectorAll('button')).find((b) => b.textContent === 'Reverse direction');
  reverse.click();
  check(store.project.connections[conn.id].from === to.id && JSON.stringify(store.project.connections[conn.id].sourceAnchor) === JSON.stringify(beforeReverse.targetAnchor) && JSON.stringify(store.project.connections[conn.id].targetAnchor) === JSON.stringify(beforeReverse.sourceAnchor), 'Reverse UI swaps endpoints and anchors');
  store.undo();
  canvas.render();
  const resetAnchors = Array.from(doc.querySelectorAll('button')).find((b) => b.textContent === 'Reset anchors');
  check(resetAnchors && !resetAnchors.disabled, 'Separate anchor reset is available');
  resetAnchors.click();
  check(!store.project.connections[conn.id].sourceAnchor && !store.project.connections[conn.id].targetAnchor && store.project.connections[conn.id].waypoints.length === 1, 'Anchor reset restores automatic attachments without deleting route');
  store.undo();
  check(JSON.stringify(store.project.connections[conn.id].targetAnchor) === JSON.stringify(beforeReverse.targetAnchor), 'Anchor reset is undoable');
  return results;
}

test('real browser export dialogs, raster alpha and PDF margins', { skip: !browser || typeof WebSocket === 'undefined', timeout: 45000 }, async () => {
  const root = path.join(__dirname, '..');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'aisbp-export-options-browser-profile-'));
  const html = '<!doctype html><body><pre id="result">pending</pre><iframe src="/index.html"></iframe><script>' +
    'document.querySelector("iframe").onload = async () => { try { const results = await (' + browserChecks.toString() +
    ')(); document.getElementById("result").textContent = "PASS " + JSON.stringify(results); } catch (e) { document.getElementById("result").textContent = "FAIL " + e.stack; }' +
    'fetch("/result", {method: "POST", body: document.getElementById("result").textContent}); };</script>';
  let report;
  const completed = new Promise((resolve) => { report = resolve; });
  const server = http.createServer((req, res) => {
    if (req.url === '/escape' || req.url.startsWith('/route-double-click?') || req.url.startsWith('/canvas-double-click?')) {
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
          const command = (id, method, params) => new Promise((resolve, reject) => {
            const receive = (event) => {
              const message = JSON.parse(event.data);
              if (message.id !== id) return;
              socket.removeEventListener('message', receive);
              message.error ? reject(new Error(message.error.message)) : resolve();
            };
            socket.addEventListener('message', receive);
            socket.send(JSON.stringify({ id, method, params }));
          });
          if (req.url !== '/escape') {
            const query = new URL(req.url, 'http://localhost').searchParams;
            const x = Number(query.get('x'));
            const y = Number(query.get('y'));
            await command(1, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
            for (let clickCount = 1; clickCount <= 2; clickCount++) {
              await command(clickCount * 2, 'Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', buttons: 1, clickCount, x, y });
              await command(clickCount * 2 + 1, 'Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', buttons: 0, clickCount, x, y });
            }
          } else {
            await command(1, 'Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
            await command(2, 'Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
          }
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
