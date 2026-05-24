#!/usr/bin/env node

const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const pluginsRoot = path.resolve(root, '..');
const tempRoot = path.join(root, '.hookdoc-build');
const docsRoot = path.join(root, 'docs');
const jsdocBin = path.join(root, 'node_modules', '.bin', 'jsdoc');

const sources = {
  free: [
    '../powered-cache/powered-cache.php',
    '../powered-cache/includes/',
  ],
  premium: [
    '../powered-cache-premium/plugin.php',
    '../powered-cache-premium/includes/',
  ],
};

const mode = process.argv[2] || 'all';
const requestedSources = getSources(mode);

function getSources(selectedMode) {
  if ('free' === selectedMode) {
    return sources.free;
  }

  if ('premium' === selectedMode) {
    return sources.premium;
  }

  if ('all' === selectedMode) {
    return sources.free.concat(sources.premium);
  }

  throw new Error(`Unknown docs build mode: ${selectedMode}`);
}

function normalizeForJSDoc(contents) {
  const lines = contents.split(/\r?\n/);
  const normalized = [];
  let skippingParamShape = false;

  for (const line of lines) {
    if (skippingParamShape) {
      if (/^\s*\*\s*\}\s*$/.test(line)) {
        skippingParamShape = false;
      }

      continue;
    }

    const objectParam = line.match(/^(\s*\*\s*)@param\s+array\s+(\$[A-Za-z_][A-Za-z0-9_]*)\s*\{\s*$/);

    if (objectParam) {
      normalized.push(`${objectParam[1]}@param {array} ${objectParam[2]} Array details.`);
      skippingParamShape = true;
      continue;
    }

    normalized.push(line);
  }

  return normalized.join('\n');
}

function copyNormalized(source, destination) {
  const stats = fs.statSync(source);

  if (stats.isDirectory()) {
    fs.mkdirSync(destination, { recursive: true });

    for (const entry of fs.readdirSync(source)) {
      copyNormalized(path.join(source, entry), path.join(destination, entry));
    }

    return;
  }

  fs.mkdirSync(path.dirname(destination), { recursive: true });

  if (/\.(php|inc)$/i.test(source)) {
    fs.writeFileSync(destination, normalizeForJSDoc(fs.readFileSync(source, 'utf8')));
    return;
  }

  fs.copyFileSync(source, destination);
}

function prepareSources() {
  fs.rmSync(tempRoot, { recursive: true, force: true });

  return requestedSources.map((sourcePath) => {
    const absoluteSource = path.resolve(root, sourcePath);
    const relativeSource = path.relative(pluginsRoot, absoluteSource);
    const tempDestination = path.join(tempRoot, relativeSource);

    copyNormalized(absoluteSource, tempDestination);

    return tempDestination;
  });
}

function run() {
  const jsdocSources = prepareSources();

  fs.rmSync(docsRoot, { recursive: true, force: true });

  try {
    childProcess.execFileSync(
      jsdocBin,
      ['-c', 'hookdoc-conf.json'].concat(jsdocSources),
      {
        cwd: root,
        stdio: 'inherit',
      }
    );
    normalizeGeneratedSourceNames();
    sanitizeGeneratedDocs();
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function normalizeGeneratedSourceNames() {
  if (!fs.existsSync(docsRoot)) {
    return;
  }

  const renameMap = new Map();

  for (const file of fs.readdirSync(docsRoot)) {
    const normalized = normalizedSourceFilename(file);

    if (normalized && normalized !== file) {
      renameMap.set(file, normalized);
    }
  }

  for (const [from, to] of renameMap.entries()) {
    const fromPath = path.join(docsRoot, from);
    const toPath = path.join(docsRoot, to);

    if (fs.existsSync(toPath)) {
      fs.unlinkSync(toPath);
    }

    fs.renameSync(fromPath, toPath);
  }

  if (!renameMap.size) {
    return;
  }

  for (const file of fs.readdirSync(docsRoot)) {
    if (!file.endsWith('.html')) {
      continue;
    }

    const filePath = path.join(docsRoot, file);
    let contents = fs.readFileSync(filePath, 'utf8');

    for (const [from, to] of renameMap.entries()) {
      contents = contents.split(from).join(to);
    }

    fs.writeFileSync(filePath, contents);
  }
}

function normalizedSourceFilename(file) {
  if (!file.endsWith('.php.html') && !file.endsWith('.inc.html')) {
    return '';
  }

  if (file.startsWith('powered-cache_includes_')) {
    return file.replace(/^powered-cache_includes_/, '');
  }

  if (file.startsWith('powered-cache_powered-cache.')) {
    return file.replace(/^powered-cache_/, '');
  }

  if (file.startsWith('powered-cache-premium_includes_')) {
    return file.replace(/^powered-cache-premium_includes_/, 'premium_');
  }

  if (file.startsWith('powered-cache-premium_plugin.')) {
    return file.replace(/^powered-cache-premium_/, 'premium_');
  }

  return '';
}

function sanitizeGeneratedDocs() {
  if (!fs.existsSync(docsRoot)) {
    return;
  }

  const blockedBrand = String.fromCharCode(87, 80, 32, 82, 111, 99, 107, 101, 116);
  const blockedSlug = String.fromCharCode(119, 112, 45, 114, 111, 99, 107, 101, 116);
  const blockedWord = String.fromCharCode(82, 111, 99, 107, 101, 116);
  const blockedWordLower = String.fromCharCode(114, 111, 99, 107, 101, 116);
  const replacements = [
    [new RegExp(`\\b${escapeRegExp(blockedBrand)}\\b`, 'g'), 'a conflicting cache plugin'],
    [new RegExp(`\\b${escapeRegExp(blockedSlug)}\\b`, 'g'), 'conflicting-cache-plugin'],
    [new RegExp(`\\b${escapeRegExp(blockedWord)}\\b`, 'g'), 'Compatibility'],
    [new RegExp(`\\b${escapeRegExp(blockedWordLower)}\\b`, 'g'), 'compatibility'],
  ];

  for (const file of fs.readdirSync(docsRoot)) {
    if (!file.endsWith('.html')) {
      continue;
    }

    const filePath = path.join(docsRoot, file);
    let contents = fs.readFileSync(filePath, 'utf8');

    for (const [pattern, replacement] of replacements) {
      contents = contents.replace(pattern, replacement);
    }

    fs.writeFileSync(filePath, contents);
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

run();
