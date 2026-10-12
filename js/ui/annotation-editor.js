/**
 * Isolated annotation drafts: canvas-anchored text editing and a shared table dialog.
 */
(function (root) {
  'use strict';
  const A = root.AISBP;
  const { h, clear, field, select, modal } = A.Dom;
  const N = A.Annotations;
  const doc = root.document;
  let active = null;

  function open(app, id) {
    if (active) active.close();
    const store = app.store;
    const node = store.project.nodes[id];
    if (!node || !N.isAnnotation(node.type)) return;
    const originalFocus = doc.activeElement;
    const focusId = originalFocus && originalFocus.id;
    const draft = N.normalize(node.type, node.attributes);
    const error = h('p', { class: 'problems', role: 'alert', hidden: true });
    let shell, popup, unsubscribe, closed = false, resetSize = false;
    const restoreFocus = () => {
      const target = originalFocus && originalFocus.isConnected ? originalFocus :
        (focusId && doc.getElementById(focusId)) || doc.getElementById('canvas');
      if (target) target.focus({ preventScroll: true });
    };
    function cleanup() {
      if (closed) return;
      closed = true;
      if (unsubscribe) unsubscribe();
      root.removeEventListener('resize', position);
      root.removeEventListener('scroll', position, true);
      if (active && active.id === id) active = null;
      if (!popup) shell.remove();
      restoreFocus();
    }
    function close() {
      if (closed) return;
      cleanup();
      if (popup) popup.close();
    }
    function fail(message) {
      error.hidden = false;
      error.textContent = message;
      return false;
    }
    function save() {
      if (closed) return false;
      if (node.type === 'annotation-table') {
        const rows = JSON.parse(draft.rows);
        if (rows.some((row) => row.some((cell) => cell.length > 1000)) || draft.caption.length > 1000) return fail('Cells and caption support up to 1,000 characters each.');
        if (JSON.parse(draft.columnWidths).some((w) => !Number.isFinite(w) || w < 50 || w > 1000)) return fail('Column widths must be between 50 and 1,000.');
      } else if (draft.content.length > 20000) return fail('Content supports up to 20,000 characters.');
      if (![draft.fontSize, draft.padding].every(Number.isFinite) || draft.fontSize < 8 || draft.fontSize > 48 || draft.padding < 0 || draft.padding > 40) return fail('Font size must be 8–48 and padding 0–40.');
      const attributes = N.normalize(node.type, draft);
      close();
      store.endMerge();
      store.change('edit annotation', (project) => {
        if (!project.nodes[id] || project.nodes[id].type !== node.type) return false;
        A.Model.updateNode(project, id, { attributes });
        if (resetSize) { delete project.nodes[id].w; delete project.nodes[id].h; }
      });
      restoreFocus();
      return true;
    }
    function keys(event) {
      // Leave native text selection, clipboard and undo shortcuts to the controls.
      event.stopPropagation();
      if (event.isComposing) return;
      if (event.key === 'Escape') { event.preventDefault(); close(); }
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); save(); }
    }
    function position() {
      if (closed || popup) return;
      const bounds = app.canvas.annotationBounds(id);
      if (!bounds) return close();
      const width = Math.min(Math.max(bounds.width, 320), 580, Math.max(0, bounds.viewportWidth - 16));
      const height = Math.min(520, Math.max(0, bounds.viewportHeight - 16));
      shell.style.width = width + 'px';
      shell.style.maxHeight = height + 'px';
      shell.style.left = Math.max(bounds.viewportLeft + 8, Math.min(bounds.left, bounds.viewportLeft + bounds.viewportWidth - width - 8)) + 'px';
      shell.style.top = Math.max(bounds.viewportTop + 8, Math.min(bounds.top, bounds.viewportTop + bounds.viewportHeight - shell.offsetHeight - 8)) + 'px';
    }
    const help = h('p', { class: 'subtitle', text: 'Ctrl/Cmd+Enter saves · Escape cancels. Changes are not applied until Save.' });
    if (node.type !== 'annotation-table') {
      const markdown = node.type === 'annotation-markdown';
      const input = h('textarea', { id: 'annotation-editor-content', value: draft.content, maxlength: 20000, 'aria-label': markdown ? 'Markdown' : 'Text', spellcheck: 'true' });
      const preview = h('div', { class: 'markdown-preview', 'aria-label': 'Markdown preview' });
      function update() {
        draft.content = input.value;
        if (!markdown) return;
        clear(preview);
        // Use the same safe Markdown subset as the canvas; only text nodes are emitted.
        N.textLayout(draft.content, 100000, 14, true, false).lines.forEach((line) => {
          preview.appendChild(h('div', { style: { fontSize: line.size + 'px', fontWeight: line.bold ? '700' : '', fontStyle: line.italic ? 'italic' : '' } },
            line.runs.map((run) => h(run.code ? 'code' : 'span', { text: run.text || '', style: { fontWeight: run.bold ? '700' : '', fontStyle: run.italic ? 'italic' : '' } }))));
        });
      }
      input.addEventListener('input', update);
      const toolbar = h('div', { class: 'markdown-toolbar', role: 'toolbar', 'aria-label': 'Markdown formatting' });
      function format(before, after, lines) {
        let start = input.selectionStart, end = input.selectionEnd;
        if (lines) {
          start = input.value.lastIndexOf('\n', start - 1) + 1;
          const next = input.value.indexOf('\n', end);
          end = next === -1 ? input.value.length : next;
        }
        const selected = input.value.slice(start, end);
        const replacement = lines ? selected.split('\n').map((line, i) => (before === '1. ' ? (i + 1) + '. ' : before) + line).join('\n') : before + selected + after;
        if (input.value.length - selected.length + replacement.length > 20000) return fail('Content supports up to 20,000 characters.');
        input.setRangeText(replacement, start, end, 'select');
        input.focus();
        update();
      }
      [['Bold', '**', '**'], ['Italic', '*', '*'], ['Heading 1', '# ', '', true], ['Heading 2', '## ', '', true], ['Heading 3', '### ', '', true],
        ['Bulleted list', '- ', '', true], ['Numbered list', '1. ', '', true], ['Code', '`', '`'], ['Code block', '```\n', '\n```'], ['Quote', '> ', '', true]].forEach(([label, before, after, lines]) => {
        toolbar.appendChild(h('button', { type: 'button', class: 'btn small', text: label, onmousedown: (e) => e.preventDefault(), onclick: () => format(before, after, lines) }));
      });
      shell = h('section', { class: 'annotation-inline-editor', role: 'dialog', 'aria-label': markdown ? 'Edit Markdown on canvas' : 'Edit Text on canvas', onkeydown: keys },
        h('h2', { text: markdown ? 'Edit Markdown' : 'Edit Text' }), markdown ? toolbar : null,
        field(markdown ? 'Markdown' : 'Text', input),
        markdown ? h('details', { open: true }, h('summary', { text: 'Safe preview' }), preview, h('p', { class: 'subtitle', text: 'Links render as text; HTML and images are not rendered.' })) : null,
        error, help, h('div', { class: 'inline' },
          h('button', { type: 'button', class: 'btn primary', text: 'Save', onclick: save }),
          h('button', { type: 'button', class: 'btn', text: 'Cancel', onclick: close })));
      doc.body.appendChild(shell);
      update();
      position();
      root.addEventListener('resize', position);
      root.addEventListener('scroll', position, true);
      input.focus({ preventScroll: true });
    } else {
      const options = h('div', { class: 'annotation-table-options' });
      function option(key, label, values) {
        const control = select(values, draft[key], { id: 'prop-annotation-' + key, onchange: () => { draft[key] = control.value; } });
        options.appendChild(field(label, control));
      }
      function numeric(key, label, min, max) {
        const control = h('input', { id: 'prop-annotation-' + key, type: 'number', min, max, value: draft[key], oninput: () => { draft[key] = control.value === '' ? NaN : Number(control.value); } });
        options.appendChild(field(label, control));
      }
      const caption = h('textarea', { id: 'prop-annotation-caption', maxlength: 1000, value: draft.caption, oninput: () => { draft.caption = caption.value; } });
      options.appendChild(field('Caption', caption));
      ['headerRow', 'firstColumnHeader', 'striped'].forEach((key, i) => {
        const cb = h('input', { id: 'prop-annotation-' + key, type: 'checkbox', checked: draft[key], onchange: () => { draft[key] = cb.checked; } });
        options.appendChild(field(['Header row', 'First column header', 'Striped rows'][i], cb, { check: true }));
      });
      option('grid', 'Borders', [{ value: 'all', label: 'All cells' }, { value: 'rows', label: 'Rows + outline' }, { value: 'outer', label: 'Outline only' }, { value: 'none', label: 'None' }]);
      option('theme', 'Theme', N.THEMES);
      option('align', 'Text alignment', N.ALIGN);
      numeric('fontSize', 'Font size', 8, 48);
      numeric('padding', 'Padding', 0, 40);
      const reset = h('input', { type: 'checkbox', onchange: () => { resetSize = reset.checked; } });
      options.appendChild(field('Reset size on save', reset, { check: true }));
      const cells = h('div', { class: 'annotation-table-cells' });
      function operation(op, index, target) {
        if (JSON.parse(draft.rows).some((row) => row.some((cell) => cell.length > 1000))) return fail('Cells support up to 1,000 characters each.');
        const data = N.tableOperation(draft.rows, op, index, target);
        const widths = JSON.parse(draft.columnWidths);
        if (op === 'addColumn' && widths.length < N.MAX_COLS) widths.splice(index + 1, 0, 150);
        if (op === 'removeColumn' && widths.length > 1) widths.splice(index, 1);
        if (op === 'moveColumn') widths.splice(target, 0, widths.splice(index, 1)[0]);
        draft.rows = JSON.stringify(data);
        draft.columnWidths = JSON.stringify(widths);
        renderCells();
      }
      const button = (label, title, action, disabled) => h('button', { type: 'button', class: 'btn small', text: label, title, 'aria-label': title, onclick: action, disabled });
      function renderCells() {
        clear(cells);
        const data = JSON.parse(draft.rows), widths = JSON.parse(draft.columnWidths);
        const heads = widths.map((width, i) => {
          const input = h('input', { type: 'number', id: 'prop-column-width-' + i, min: 50, max: 1000, value: width, 'aria-label': 'Column ' + (i + 1) + ' width',
            oninput: () => { const cw = JSON.parse(draft.columnWidths); cw[i] = input.value === '' ? null : Number(input.value); draft.columnWidths = JSON.stringify(cw); } });
          return h('th', {}, h('div', { text: 'Column ' + (i + 1) }), input, h('div', { class: 'inline' },
            button('←', 'Move column ' + (i + 1) + ' left', () => operation('moveColumn', i, i - 1), i === 0),
            button('→', 'Move column ' + (i + 1) + ' right', () => operation('moveColumn', i, i + 1), i === widths.length - 1),
            button('−', 'Remove column ' + (i + 1), () => operation('removeColumn', i), widths.length === 1),
            button('A↑', 'Sort column ' + (i + 1) + ' ascending', () => operation('sortAsc', i, draft.headerRow)),
            button('A↓', 'Sort column ' + (i + 1) + ' descending', () => operation('sortDesc', i, draft.headerRow))));
        });
        const body = data.map((row, ri) => h('tr', {}, h('th', {}, h('div', { text: 'Row ' + (ri + 1) }),
          button('↑', 'Move row ' + (ri + 1) + ' up', () => operation('moveRow', ri, ri - 1), ri === 0),
          button('↓', 'Move row ' + (ri + 1) + ' down', () => operation('moveRow', ri, ri + 1), ri === data.length - 1),
          button('−', 'Remove row ' + (ri + 1), () => operation('removeRow', ri), data.length === 1)), row.map((value, ci) => {
          const input = h('textarea', { id: 'prop-cell-' + ri + '-' + ci, value, maxlength: 1000, 'aria-label': 'Row ' + (ri + 1) + ', column ' + (ci + 1),
            oninput: () => { const next = JSON.parse(draft.rows); next[ri][ci] = input.value; draft.rows = JSON.stringify(next); } });
          return h('td', {}, input);
        })));
        cells.appendChild(h('div', { class: 'annotation-table-scroll' }, h('table', {}, h('thead', {}, h('tr', {}, h('th', { text: 'Rows' }), heads)), h('tbody', {}, body))));
        cells.appendChild(h('div', { class: 'inline' },
          button('Add row', 'Add row at end', () => operation('addRow', data.length - 1), data.length >= N.MAX_ROWS),
          button('Add column', 'Add column at end', () => operation('addColumn', widths.length - 1), widths.length >= N.MAX_COLS)));
      }
      renderCells();
      shell = h('div', { onkeydown: keys }, options, h('h3', { text: 'Cells' }), h('p', { class: 'subtitle', text: 'Multiline cells; up to 50 rows and 12 columns. Column widths are proportional when manually resized. Sorting preserves the header row.' }), cells, error, help);
      popup = modal({ title: 'Edit Table', body: shell, buttons: [{ label: 'Cancel', action: close }, { label: 'Save', primary: true, action: () => save() ? undefined : false }], onClose: cleanup });
      popup.dialog.classList.add('annotation-table-dialog');
      popup.dialog.addEventListener('keydown', keys);
      popup.dialog.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
      doc.getElementById('prop-cell-0-0').focus();
    }
    active = { id, close, position, app };
    unsubscribe = store.subscribe((reason) => {
      if (reason !== 'selection' || !store.selection.nodes.has(id)) close();
    });
  }

  A.AnnotationEditor = {
    open,
    isOpen: (app) => !!active && active.app === app,
    reposition: (app) => { if (active && active.app === app) active.position(); }
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
