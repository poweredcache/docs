#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const sources = [
  path.resolve(root, '../powered-cache/powered-cache.php'),
  path.resolve(root, '../powered-cache/includes'),
  path.resolve(root, '../powered-cache-premium/plugin.php'),
  path.resolve(root, '../powered-cache-premium/includes'),
];

const errors = [];
const warnings = [];
let hookCount = 0;

for (const source of sources) {
  for (const file of collectPhpFiles(source)) {
    validateFile(file);
  }
}

for (const warning of warnings) {
  console.warn(`WARN ${warning}`);
}

for (const error of errors) {
  console.error(`ERROR ${error}`);
}

if (errors.length > 0) {
  process.exit(1);
}

console.log(`Validated ${hookCount} documented hooks.`);

function collectPhpFiles(source) {
  if (!fs.existsSync(source)) {
    return [];
  }

  const stats = fs.statSync(source);

  if (stats.isFile()) {
    return /\.(php|inc)$/i.test(source) ? [source] : [];
  }

  const files = [];

  for (const entry of fs.readdirSync(source)) {
    const next = path.join(source, entry);
    const relative = path.relative(root, next);

    if (relative.includes(`${path.sep}vendor${path.sep}`) || relative.includes(`${path.sep}node_modules${path.sep}`)) {
      continue;
    }

    files.push(...collectPhpFiles(next));
  }

  return files;
}

function validateFile(file) {
  const contents = fs.readFileSync(file, 'utf8');
  const docblockPattern = /\/\*\*[\s\S]*?\*\//g;
  let match;

  while ((match = docblockPattern.exec(contents)) !== null) {
    const block = match[0];
    const hookMatch = block.match(/@hook\s+([^\s*]+)/);

    if (!hookMatch) {
      continue;
    }

    hookCount += 1;

    const hookName = hookMatch[1].trim();
    const line = lineNumber(contents, match.index);
    const location = `${path.relative(root, file)}:${line}`;

    if (!/@since\s+/.test(block)) {
      errors.push(`${location} documents ${hookName} without @since.`);
    }

    const call = findNextHookCall(contents, match.index + block.length);

    if (!call) {
      errors.push(`${location} documents ${hookName}, but no nearby apply_filters() or do_action() call was found.`);
      continue;
    }

    if (call.registration) {
      warnings.push(`${location} documents ${hookName} near ${call.type}(); validator skipped exact source-call comparison.`);
      continue;
    }

    if (call.dynamic) {
      warnings.push(`${location} documents dynamic hook ${hookName}; exact call name cannot be statically compared.`);
      continue;
    }

    if (call.name !== hookName) {
      errors.push(`${location} documents ${hookName}, but the nearby ${call.type}() call uses ${call.name}.`);
    }
  }
}

function findNextHookCall(contents, offset) {
  const window = contents.slice(offset, offset + 1800);
  const nextDocblock = window.indexOf('/**');
  const searchWindow = nextDocblock >= 0 ? window.slice(0, nextDocblock) : window;

  const literalCall = searchWindow.match(/\b(apply_filters|do_action|add_filter|add_action)\s*\(\s*(['"])([^'"]+)\2\s*(?:,|\))/);

  if (literalCall) {
    return {
      type: literalCall[1],
      name: literalCall[3],
      registration: literalCall[1].startsWith('add_'),
      dynamic: false,
    };
  }

  const dynamicCall = searchWindow.match(/\b(apply_filters|do_action|add_filter|add_action)\s*\(/);

  if (dynamicCall) {
    return {
      type: dynamicCall[1],
      name: null,
      registration: dynamicCall[1].startsWith('add_'),
      dynamic: true,
    };
  }

  return null;
}

function lineNumber(contents, offset) {
  return contents.slice(0, offset).split(/\r?\n/).length;
}
