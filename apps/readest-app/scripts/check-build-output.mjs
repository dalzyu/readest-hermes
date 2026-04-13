import fs from 'node:fs';
import path from 'node:path';

const mode = process.argv[2];
const appRoot = process.cwd();

const collectFiles = (roots) =>
  roots.flatMap((root) => {
    const fullRoot = path.join(appRoot, root);
    if (!fs.existsSync(fullRoot)) return [];

    const entries = fs.readdirSync(fullRoot, { withFileTypes: true });
    return entries.flatMap((entry) => {
      const relative = path.join(root, entry.name);
      if (entry.isDirectory()) {
        return collectFiles([relative]);
      }
      return [path.join(appRoot, relative)];
    });
  });

const countMatches = (files, pattern) =>
  files.reduce((count, file) => {
    const content = fs.readFileSync(file, 'utf8');
    const matches = content.match(pattern);
    return count + (matches?.length ?? 0);
  }, 0);

const countCodeMatches = (files, token) =>
  files.reduce((count, file) => count + countCodeToken(fs.readFileSync(file, 'utf8'), token), 0);

const countCodeToken = (content, token) => {
  let count = 0;
  let mode = 'code';
  let escape = false;
  const templateExpressionStack = [];

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    const next = content[index + 1];

    if (mode === 'line-comment') {
      if (char === '\n') mode = 'code';
      continue;
    }

    if (mode === 'block-comment') {
      if (char === '*' && next === '/') {
        mode = 'code';
        index += 1;
      }
      continue;
    }

    if (mode === 'single-quote' || mode === 'double-quote') {
      if (escape) {
        escape = false;
        continue;
      }
      if (char === '\\') {
        escape = true;
        continue;
      }
      if ((mode === 'single-quote' && char === "'") || (mode === 'double-quote' && char === '"')) {
        mode = 'code';
      }
      continue;
    }

    if (mode === 'template') {
      if (escape) {
        escape = false;
        continue;
      }
      if (char === '\\') {
        escape = true;
        continue;
      }
      if (char === '`') {
        mode = 'code';
        continue;
      }
      if (char === '$' && next === '{') {
        templateExpressionStack.push(1);
        mode = 'code';
        index += 1;
      }
      continue;
    }

    if (char === '/' && next === '/') {
      mode = 'line-comment';
      index += 1;
      continue;
    }
    if (char === '/' && next === '*') {
      mode = 'block-comment';
      index += 1;
      continue;
    }
    if (char === "'") {
      mode = 'single-quote';
      continue;
    }
    if (char === '"') {
      mode = 'double-quote';
      continue;
    }
    if (char === '`') {
      mode = 'template';
      continue;
    }

    if (templateExpressionStack.length > 0) {
      if (char === '{') {
        templateExpressionStack[templateExpressionStack.length - 1] += 1;
      } else if (char === '}') {
        const nextDepth = templateExpressionStack[templateExpressionStack.length - 1] - 1;
        if (nextDepth === 0) {
          templateExpressionStack.pop();
          mode = 'template';
          continue;
        }
        templateExpressionStack[templateExpressionStack.length - 1] = nextDepth;
      }
    }

    if (content.startsWith(token, index)) {
      count += 1;
    }
  }

  return count;
};

const report = (count, failureMessage, successMessage) => {
  if (count > 0) {
    console.error(failureMessage);
    process.exit(1);
  }

  console.log(successMessage);
};

switch (mode) {
  case 'translations': {
    const localeFiles = collectFiles(['public/locales']).filter((file) =>
      file.endsWith('.json'),
    );
    const count = countMatches(localeFiles, /__STRING_NOT_TRANSLATED__/g);
    report(count, 'Untranslated strings found in locale output.', 'All strings translated.');
    break;
  }

  case 'optional-chaining': {
    const chunkFiles = collectFiles(['.next/static/chunks', 'out/_next/static/chunks']);
    const count = countMatches(chunkFiles, /\?\.[a-zA-Z_$]/g);
    report(count, 'Optional chaining found in build output.', 'No optional chaining found.');
    break;
  }

  case 'lookbehind-regex': {
    const chunkFiles = collectFiles(['.next/static/chunks', 'out/_next/static/chunks']);
    const count = countCodeMatches(chunkFiles, '(?<');
    report(count, 'Lookbehind regex found in build output.', 'No lookbehind regex found.');
    break;
  }

  default:
    console.error(`Unknown check mode: ${mode ?? '<missing>'}`);
    process.exit(2);
}
