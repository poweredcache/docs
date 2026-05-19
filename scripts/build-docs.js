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
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

run();
