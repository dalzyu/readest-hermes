import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PLACEHOLDER = '__STRING_NOT_TRANSLATED__';
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const localesDir = path.resolve(scriptDir, '../public/locales');

const replacePlaceholders = (value) => {
  if (Array.isArray(value)) {
    let changed = false;
    const nextValue = value.map((item) => {
      const result = replacePlaceholders(item);
      changed ||= result.changed;
      return result.value;
    });
    return { value: nextValue, changed };
  }

  if (value && typeof value === 'object') {
    let changed = false;
    const nextValue = Object.fromEntries(
      Object.entries(value).map(([key, entryValue]) => {
        if (entryValue === PLACEHOLDER) {
          changed = true;
          return [key, key];
        }

        const result = replacePlaceholders(entryValue);
        changed ||= result.changed;
        return [key, result.value];
      }),
    );

    return { value: nextValue, changed };
  }

  return { value, changed: false };
};

const main = async () => {
  const localeEntries = await readdir(localesDir, { withFileTypes: true });
  let updatedFiles = 0;

  for (const localeEntry of localeEntries) {
    if (!localeEntry.isDirectory()) {
      continue;
    }

    const translationPath = path.join(localesDir, localeEntry.name, 'translation.json');
    const raw = await readFile(translationPath, 'utf8');
    const parsed = JSON.parse(raw);
    const result = replacePlaceholders(parsed);

    if (!result.changed) {
      continue;
    }

    await writeFile(translationPath, `${JSON.stringify(result.value, null, 2)}\n`, 'utf8');
    updatedFiles += 1;
  }

  console.log(`Updated ${updatedFiles} locale file(s).`);
};

await main();