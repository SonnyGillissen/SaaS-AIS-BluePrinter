/**
 * AIS BluePrinter - palette of resource types.
 *
 * Items can be dragged onto the canvas or the explorer (HTML5 drag-and-drop), or clicked to
 * add them to the selected container (or the best matching container).
 *
 * @module AISBP.Palette
 */
(function (root) {
  'use strict';

  const AISBP = (root.AISBP = root.AISBP || {});
  const { h, clear, icon } = AISBP.Dom;

  /** MIME type used for palette drags. */
  const DRAG_TYPE = 'application/x-aisbp-type';

  function mount(el, app) {
    const search = h('input', { type: 'search', class: 'search', placeholder: 'Search resources\u2026', 'aria-label': 'Search resources' });
    const list = h('div');
    el.appendChild(search);
    el.appendChild(list);
    el.appendChild(h('p', { class: 'palette-note', text: 'Tip: drag an item onto the canvas or into a container, or click it to add it to the selected container.' }));

    const collapsed = new Set();

    function render() {
      const q = search.value.trim().toLowerCase();
      const project = app.store.project;
      clear(list);
      AISBP.Catalog.CATEGORIES.forEach((cat) => {
        const types = AISBP.Catalog.byCategory(cat.id).filter((t) => !q || t.label.toLowerCase().indexOf(q) !== -1 || t.abbr.toLowerCase().indexOf(q) !== -1 || (t.provider || '').toLowerCase().indexOf(q) !== -1);
        if (!types.length) return;
        const details = h('details', { class: 'palette-group', open: q || !collapsed.has(cat.id) },
          h('summary', { text: cat.label + ' (' + types.length + ')' }),
          h('div', { class: 'palette-items' }, types.map((t) => {
            // A <div role="button"> instead of <button>: Safari (WebKit) does not start HTML5
            // drags from button elements and selects the page text instead.
            const item = h('div', {
              role: 'button',
              tabindex: '0',
              class: 'palette-item',
              draggable: 'true',
              title: t.label + (t.provider ? '\n' + t.provider : '') + '\nDrag onto the canvas or click to add',
              'data-type': t.id,
              onclick: () => app.actions.addAuto(t.id),
              onkeydown: (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  app.actions.addAuto(t.id);
                }
              },
              ondragstart: (e) => {
                e.dataTransfer.setData(DRAG_TYPE, t.id);
                e.dataTransfer.setData('text/plain', t.label);
                e.dataTransfer.effectAllowed = 'copy';
                app.dragType = t.id;
              },
              ondragend: () => { app.dragType = null; }
            }, icon(project, t.id, 24), h('span', { text: t.label }));
            return item;
          })));
        details.addEventListener('toggle', () => {
          if (q) return;
          if (details.open) collapsed.delete(cat.id);
          else collapsed.add(cat.id);
        });
        list.appendChild(details);
      });
      if (!list.firstChild) list.appendChild(h('p', { class: 'palette-note', text: 'No resources match "' + search.value + '".' }));
    }

    search.addEventListener('input', render);
    render();
    return { render };
  }

  AISBP.Palette = { mount, DRAG_TYPE };
})(typeof globalThis !== 'undefined' ? globalThis : this);
