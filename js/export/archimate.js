/**
 * AIS BluePrinter - ArchiMate export.
 *
 * Generates an "ArchiMate Model Exchange File Format" (The Open Group, ArchiMate 3.x) XML
 * document. It can be imported by Archi (File > Import > Open Exchange XML Model), BiZZdesign,
 * Sparx EA, MEGA and other ArchiMate tools.
 *
 *  - every object becomes an ArchiMate element (type from the catalog, e.g. Logic App =
 *    ApplicationProcess, Service Bus = SystemSoftware, management group = Grouping),
 *  - attributes become properties (with property definitions),
 *  - the Azure hierarchy becomes Aggregation (from groupings) / Composition relationships and
 *    an "Azure hierarchy" organization folder,
 *  - connections become Flow / Triggering / Serving / Access / Association relationships,
 *  - one view with the same layout as the blueprint (nested nodes, absolute coordinates).
 *
 * @module AISBP.ArchiMate
 */
(function (root) {
  'use strict';

  const AISBP = (root.AISBP = root.AISBP || {});
  const Util = AISBP.Util || (typeof require === 'function' ? require('../core/util.js') : null);
  const Catalog = AISBP.Catalog || (typeof require === 'function' ? require('../core/catalog.js') : null);
  const Model = AISBP.Model || (typeof require === 'function' ? require('../core/model.js') : null);
  const Layout = AISBP.Layout || (typeof require === 'function' ? require('../core/layout.js') : null);
  const Embedded = AISBP.Embedded || (typeof require === 'function' ? require('./embedded.js') : null);

  const esc = Util.escapeXml;
  const NS = 'http://www.opengroup.org/xsd/archimate/3.0/';
  const PASSIVE = new Set(['DataObject', 'Artifact', 'Contract', 'BusinessObject', 'Representation']);

  const name = (text) => '<name xml:lang="en">' + esc(text) + '</name>';
  const doc = (text) => (text ? '<documentation xml:lang="en">' + esc(text) + '</documentation>' : '');

  /** Relationship type for a connection, falling back to Association when not meaningful. */
  function relationshipType(kind, sourceType, targetType) {
    const k = Model.CONNECTION_KINDS.find((x) => x.id === kind) || Model.CONNECTION_KINDS[0];
    const t = k.archimate;
    if (t === 'Access') return PASSIVE.has(targetType) && !PASSIVE.has(sourceType) ? 'Access' : 'Association';
    if ((t === 'Flow' || t === 'Triggering' || t === 'Serving') && (PASSIVE.has(sourceType) || PASSIVE.has(targetType) || sourceType === 'Grouping' || targetType === 'Grouping')) return 'Association';
    return t;
  }

  /**
   * Export a project to the ArchiMate exchange format.
   * @returns {string} XML document
   */
  function toArchiMate(project, opts) {
    const g = Layout.compute(project);
    const ids = {};
    const eid = (id) => (ids[id] = ids[id] || 'id-' + id);
    const elementType = (node) => {
      const def = Catalog.get(node.type);
      return def ? def.archimate : 'ApplicationComponent';
    };

    // Property definitions: one per attribute label used.
    const propDefs = new Map();
    const propRef = (label) => {
      if (!propDefs.has(label)) propDefs.set(label, 'propid-' + (propDefs.size + 1));
      return propDefs.get(label);
    };
    const prop = (label, value) => '<property propertyDefinitionRef="' + propRef(label) + '"><value xml:lang="en">' + esc(value) + '</value></property>';

    // Elements
    let elements = '';
    const nodes = Object.keys(project.nodes).map((k) => project.nodes[k]).sort((a, b) => a.seq - b.seq);
    nodes.forEach((node) => {
      const def = Catalog.get(node.type);
      const r = g.rects[node.id];
      let props = prop('Azure type', def ? def.label : node.type);
      if (def && def.provider) props += prop('Resource provider', def.provider);
      (def ? def.attributes : []).forEach((a) => {
        const v = Layout.formatValue(a, node.attributes[a.key]);
        if (v && a.key !== 'description') props += prop(a.label, v);
      });
      const links = Layout.networkLabel(project, node);
      if (links) props += prop('Network', links);
      (node.custom || []).forEach((c) => { if (c.key && c.value !== '') props += prop(c.key, c.value); });
      (node.tags || []).forEach((t) => { props += prop('Tag: ' + t.key, t.value); });
      elements += '<element identifier="' + eid(node.id) + '" xsi:type="' + elementType(node) + '">' + name(r ? r.name : node.name) + doc(node.attributes && node.attributes.description) + '<properties>' + props + '</properties></element>';
    });

    // Relationships: hierarchy + connections
    let relationships = '';
    const relIds = {};
    nodes.forEach((node) => {
      if (!node.parentId || !project.nodes[node.parentId]) return;
      const parent = project.nodes[node.parentId];
      const type = elementType(parent) === 'Grouping' ? 'Aggregation' : 'Composition';
      const rid = 'id-h-' + node.id;
      relIds['h-' + node.id] = rid;
      relationships += '<relationship identifier="' + rid + '" source="' + eid(parent.id) + '" target="' + eid(node.id) + '" xsi:type="' + type + '"/>';
    });
    Object.keys(project.connections).forEach((cid) => {
      const c = project.connections[cid];
      const from = project.nodes[c.from];
      const to = project.nodes[c.to];
      if (!from || !to) return;
      const type = relationshipType(c.kind, elementType(from), elementType(to));
      const rid = 'id-' + c.id;
      relIds[c.id] = rid;
      let props = '';
      if (c.attributes && c.attributes.protocol) props += prop('Protocol', c.attributes.protocol);
      if (c.direction === 'bidirectional') props += prop('Direction', 'Bidirectional');
      if (props) props = '<properties>' + props + '</properties>';
      relationships += '<relationship identifier="' + rid + '" source="' + eid(c.from) + '" target="' + eid(c.to) + '" xsi:type="' + type + '">' + (c.label ? name(c.label) : '') + props + '</relationship>';
    });

    // Network links (resource attached to a VNet/subnet) become Association relationships.
    nodes.forEach((node) => {
      Model.networkLinks(project, node).forEach((target) => {
        const rid = 'id-net-' + node.id + '-' + target.id;
        relIds['net-' + node.id + '-' + target.id] = rid;
        relationships += '<relationship identifier="' + rid + '" source="' + eid(node.id) + '" target="' + eid(target.id) + '" xsi:type="Association">' + name('attached to network') + '</relationship>';
      });
    });

    // Organizations: mirror the Azure hierarchy in a folder structure.
    const orgItem = (node) => {
      const kids = Model.children(project, node.id);
      if (!kids.length) return '<item identifierRef="' + eid(node.id) + '"/>';
      return '<item><label xml:lang="en">' + esc(g.rects[node.id] ? g.rects[node.id].name : node.name) + '</label><item identifierRef="' + eid(node.id) + '"/>' + kids.map(orgItem).join('') + '</item>';
    };
    const organizations = '<organizations><item><label xml:lang="en">Azure hierarchy</label>' + Model.children(project, null).map(orgItem).join('') + '</item>' +
      (Object.keys(relIds).length ? '<item><label xml:lang="en">Relations</label>' + Object.keys(relIds).map((k) => '<item identifierRef="' + relIds[k] + '"/>').join('') + '</item>' : '') + '</organizations>';

    // View: nested nodes with absolute, non-negative coordinates.
    const shiftX = Math.round(20 - g.bounds.x);
    const shiftY = Math.round(20 - g.bounds.y);
    const viewNodeId = (id) => 'id-v-' + id;
    const viewNode = (node) => {
      const r = g.rects[node.id];
      const kids = Model.children(project, node.id);
      if (!r || r.hidden || !r.w) return kids.map(viewNode).join('');
      return '<node identifier="' + viewNodeId(node.id) + '" elementRef="' + eid(node.id) + '" xsi:type="Element" x="' + Math.round(r.x + shiftX) + '" y="' + Math.round(r.y + shiftY) + '" w="' + Math.max(1, Math.round(r.w)) + '" h="' + Math.max(1, Math.round(r.h)) + '">' +
        kids.map(viewNode).join('') + '</node>';
    };
    let viewContent = Model.children(project, null).map(viewNode).join('');
    Object.keys(project.connections).forEach((cid) => {
      const c = project.connections[cid];
      const a = g.rects[c.from];
      const b = g.rects[c.to];
      if (!relIds[c.id] || !a || !b || a.hidden || b.hidden) return;
      const routing = Model.cleanWaypoints(c.waypoints).map((pt) => '<bendpoint x="' + Math.round(pt.x + shiftX) + '" y="' + Math.round(pt.y + shiftY) + '"/>').join('');
      viewContent += '<connection identifier="id-vc-' + c.id + '" relationshipRef="' + relIds[c.id] + '" xsi:type="Relationship" source="' + viewNodeId(c.from) + '" target="' + viewNodeId(c.to) + '">' + routing + '</connection>';
    });

    let propertyDefinitions = '';
    propDefs.forEach((id, label) => { propertyDefinitions += '<propertyDefinition identifier="' + id + '" type="string">' + name(label) + '</propertyDefinition>'; });

    const xml = '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<model xmlns="' + NS + '" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="' + NS + ' http://www.opengroup.org/xsd/archimate/3.1/archimate3_Diagram.xsd" identifier="id-' + esc(project.meta.id) + '">' +
      name(project.meta.name) + doc(project.meta.description || 'Generated by AIS BluePrinter') +
      '<elements>' + elements + '</elements>' +
      (relationships ? '<relationships>' + relationships + '</relationships>' : '') +
      organizations +
      (propertyDefinitions ? '<propertyDefinitions>' + propertyDefinitions + '</propertyDefinitions>' : '') +
      '<views><diagrams><view identifier="id-view-main" xsi:type="Diagram">' + name(project.meta.name) + viewContent + '</view></diagrams></views>' +
      '</model>\n';
    return Embedded.toXml(xml, project, opts);
  }

  AISBP.ArchiMate = { toArchiMate, relationshipType };

  if (typeof module !== 'undefined' && module.exports) module.exports = AISBP.ArchiMate;
})(typeof globalThis !== 'undefined' ? globalThis : this);
