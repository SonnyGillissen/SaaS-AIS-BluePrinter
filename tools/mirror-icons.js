#!/usr/bin/env node
/**
 * AIS BluePrinter - MS Icons mirror.
 *
 * Downloads every icon referenced by the resource catalog (js/core/catalog.js) from the
 * MS Icons community library (https://msicons.com, by Daniel Bradley; icons (c) Microsoft)
 * into icons/msicons/ so the application can run without internet access or in networks that
 * block msicons.com. When msicons.com is unreachable, the tool falls back to the library's
 * GitHub repository (https://github.com/DanielBradley1/msicons).
 *
 * Usage:
 *   node tools/mirror-icons.js [--out icons/msicons] [--force]
 *
 * Afterwards set the icon base URL to 'icons/msicons/' in js/config.js
 * (defaults.icons.baseUrl) or per project in Options > Icons.
 *
 * Requires Node.js 18+ (global fetch). No dependencies.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Catalog = require('../js/core/catalog.js');

const SOURCES = [
  'https://msicons.com/icons/',
  'https://raw.githubusercontent.com/DanielBradley1/msicons/main/msicons/public/icons/'
];
const MAX_BYTES = 1024 * 1024;
const SAFE_PATH = /^[A-Za-z0-9_-]+\/[A-Za-z0-9_.+()-]+\.svg$/;

function parseArgs(argv) {
  const args = { out: path.join(__dirname, '..', 'icons', 'msicons'), force: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out') args.out = path.resolve(argv[++i]);
    else if (argv[i] === '--force') args.force = true;
    else if (argv[i] === '--help' || argv[i] === '-h') args.help = true;
  }
  return args;
}

/** All distinct icon paths used by the catalog (validated, relative to the library root). */
function iconPaths() {
  const paths = new Set(Catalog.all().map((t) => t.icon).filter(Boolean));
  return [...paths].filter((p) => SAFE_PATH.test(p)).sort();
}

/** True when the payload looks like an SVG document without active content. */
function isPlainSvg(text) {
  return /<svg[\s>]/i.test(text) && !/<script[\s>]|\son[a-z]+\s*=|javascript:/i.test(text);
}

async function download(iconPath) {
  let lastError = null;
  for (const base of SOURCES) {
    try {
      const res = await fetch(base + iconPath, { redirect: 'follow' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const text = await res.text();
      if (text.length > MAX_BYTES) throw new Error('file too large');
      if (!isPlainSvg(text)) throw new Error('not a plain SVG document');
      return { text, source: base };
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError || new Error('no source available');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('Usage: node tools/mirror-icons.js [--out icons/msicons] [--force]');
    return;
  }
  const list = iconPaths();
  let ok = 0;
  let skipped = 0;
  const failed = [];
  for (const iconPath of list) {
    const target = path.join(args.out, ...iconPath.split('/'));
    if (!args.force && fs.existsSync(target)) {
      skipped++;
      continue;
    }
    try {
      const { text, source } = await download(iconPath);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, text);
      ok++;
      console.log('✓ ' + iconPath + (source === SOURCES[0] ? '' : '  (from GitHub)'));
    } catch (e) {
      failed.push(iconPath);
      console.error('✗ ' + iconPath + ': ' + e.message);
    }
  }
  fs.mkdirSync(args.out, { recursive: true });
  fs.writeFileSync(
    path.join(args.out, 'ATTRIBUTION.txt'),
    'Icons mirrored from MS Icons (https://msicons.com), a community project by Daniel Bradley\n' +
      '(https://github.com/DanielBradley1/msicons). The icons are the official Microsoft Azure\n' +
      'architecture icons, (c) Microsoft, and are subject to Microsoft\'s icon terms of use:\n' +
      'https://learn.microsoft.com/azure/architecture/icons/\n'
  );
  console.log(`\n${ok} downloaded, ${skipped} already present, ${failed.length} failed -> ${args.out}`);
  console.log("Set the icon base URL to 'icons/msicons/' (js/config.js defaults.icons.baseUrl or Options > Icons).");
  if (failed.length) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
}

module.exports = { iconPaths, isPlainSvg, SOURCES };
