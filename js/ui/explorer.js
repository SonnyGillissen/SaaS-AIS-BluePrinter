/**
 * AIS BluePrinter - explorer (hierarchy tree).
 *
 * Shows management groups > subscriptions > resource groups > resources as a tree. Rows can
 * be dragged onto other rows to move objects in the hierarchy, and palette items can be
 * dropped on a row to add a child.
 *
 * @module AISBP.Explorer
 */
(function (root) {
  'use strict';

  const AISBP = (root.AISBP = root.AISBP || {});
  const { h, clear, icon } = AISBP.Dom;
  const NODE_DRAG = 'application/x-aisbp-node';

  function mount(el, app) {
    const tree = h('ul', { class: 'tree', role: 'tree', 'aria-label': 'Blueprint hierarchy' });
    const rootDrop = h('div', { class: 'tree-root-drop', text: 'Drop here to move to the top level' });
    const connList = h('div');
    el.appendChild(tree);
    el.appendChild(rootDrop);
    el.appendChild(connList);
    let dragIds = null;

    /** Whether the current drag may be dropped on `targetId` (null = top level). */
    function canDrop(targetId) {
      const project = app.store.project;
      if (dragIds) return dragIds.every((id) => (targetId ? !AISBP.Model.isSelfOrDescendant(project, id, targetId) : true) && AISBP.Model.canContain(project, targetId, project.nodes[id].type));
      if (app.dragType) return AISBP.Model.canContain(project, targetId, app.dragType);
      return false;
    }

    function dropHandlers(target, targetId) {
      // Safari only allows a drop when both dragenter and dragover are cancelled.
      const allow = (e) => {
        if (!canDrop(targetId)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = dragIds ? 'move' : 'copy';
        target.classList.add('drop-ok');
      };
      target.addEventListener('dragenter', allow);
      target.addEventListener('dragover', allow);
      target.addEventListener('dragleave', () => target.classList.remove('drop-ok'));
      target.addEventListener('drop', (e) => {
        target.classList.remove('drop-ok');
        e.preventDefault();
        e.stopPropagation();
        const type = e.dataTransfer.getData(AISBP.Palette.DRAG_TYPE) || app.dragType;
        if (dragIds) app.actions.reparent(dragIds, targetId);
        else if (type) app.actions.addInto(type, targetId);
        dragIds = null;
      });
    }
    dropHandlers(rootDrop, null);

    function row(node, derived) {
      const project = app.store.project;
      const def = AISBP.Catalog.get(node.type);
      const selected = app.store.selection.nodes.has(node.id);
      const problems = derived.problems[node.id];
      const name = derived.geometry.names[node.id] || def.label;
      const r = h('div', {
        class: 'tree-row' + (selected ? ' selected' : ''),
        role: 'treeitem',
        'aria-selected': selected ? 'true' : 'false',
        draggable: 'true',
        title: name + ' (' + def.label + ')' + (problems ? '\n\u26a0 ' + problems.join('\n\u26a0 ') : ''),
        onclick: (e) => app.store.select([node.id], [], e.ctrlKey || e.metaKey || e.shiftKey),
        ondblclick: () => app.canvas.centerOn(node.id),
        ondragstart: (e) => {
          dragIds = app.store.selection.nodes.has(node.id) ? AISBP.Model.topLevelOnly(project, app.store.selectedNodes()) : [node.id];
          e.dataTransfer.setData(NODE_DRAG, dragIds.join(','));
          e.dataTransfer.effectAllowed = 'move';
        },
        ondragend: () => { dragIds = null; }
      }, icon(project, node.type, 16), h('span', { class: 'name', text: name }), problems ? h('span', { class: 'problem', text: '!', 'aria-label': 'Has problems' }) : null);
      dropHandlers(r, node.id);
      const kids = AISBP.Model.children(project, node.id);
      return h('li', {}, r, kids.length ? h('ul', { role: 'group' }, kids.map((k) => row(k, derived))) : null);
    }

    function render() {
      const project = app.store.project;
      const derived = app.store.derived();
      clear(tree);
      const top = AISBP.Model.children(project, null);
      if (!top.length) tree.appendChild(h('li', { class: 'palette-note', text: 'The blueprint is empty. Drag items from the palette.' }));
      top.forEach((n) => tree.appendChild(row(n, derived)));

      clear(connList);
      const conns = Object.keys(project.connections).map((k) => project.connections[k]);
      if (conns.length) {
        connList.appendChild(h('h4', { class: 'palette-note', text: 'Connections (' + conns.length + ')' }));
        connList.appendChild(h('ul', { class: 'tree' }, conns.map((c) => {
          const kind = AISBP.Model.CONNECTION_KINDS.find((k) => k.id === c.kind);
          const label = (derived.geometry.names[c.from] || '?') + ' \u2192 ' + (derived.geometry.names[c.to] || '?');
          return h('li', {}, h('div', {
            class: 'tree-row' + (app.store.selection.conns.has(c.id) ? ' selected' : ''),
            title: (kind ? kind.label : c.kind) + (c.label ? ': ' + c.label : ''),
            onclick: (e) => app.store.select([], [c.id], e.ctrlKey || e.metaKey || e.shiftKey)
          }, h('span', { class: 'name', text: label + (c.label ? ' (' + c.label + ')' : '') })));
        })));
      }
    }

    return { render };
  }

  AISBP.Explorer = { mount };
})(typeof globalThis !== 'undefined' ? globalThis : this);
