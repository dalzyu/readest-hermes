// scripts/dictionaries/build.mjs
// Node.js 18+ built-in fetch — no external dependencies needed
import { writeFileSync, mkdirSync } from 'node:fs';
import { createGzip } from 'node:zlib';
import { Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const STUBS = [
  { id: 'bundled-zh-en', language: 'zh', targetLanguage: 'en', entries: [
    { headword: '你好', definition: 'hello' },
    { headword: '世界', definition: 'world' },
    { headword: '学习', definition: 'to study, to learn' },
  ]},
  { id: 'bundled-ja-en', language: 'ja', targetLanguage: 'en', entries: [
    { headword: 'こんにちは', definition: 'hello' },
    { headword: '世界', definition: 'world' },
    { headword: '学習', definition: 'learning, study' },
  ]},
  { id: 'bundled-ko-en', language: 'ko', targetLanguage: 'en', entries: [
    { headword: '안녕하세요', definition: 'hello' },
    { headword: '세계', definition: 'world' },
    { headword: '학습', definition: 'learning, study' },
  ]},
  { id: 'bundled-fr-en', language: 'fr', targetLanguage: 'en', entries: [
    { headword: 'bonjour', definition: 'hello' },
    { headword: 'monde', definition: 'world' },
    { headword: 'apprentissage', definition: 'learning, study' },
  ]},
  { id: 'bundled-de-en', language: 'de', targetLanguage: 'en', entries: [
    { headword: 'hallo', definition: 'hello' },
    { headword: 'welt', definition: 'world' },
    { headword: 'lernen', definition: 'to learn, learning' },
  ]},
  { id: 'bundled-es-en', language: 'es', targetLanguage: 'en', entries: [
    { headword: 'hola', definition: 'hello' },
    { headword: 'mundo', definition: 'world' },
    { headword: 'aprendizaje', definition: 'learning, study' },
  ]},
  { id: 'bundled-pt-en', language: 'pt', targetLanguage: 'en', entries: [
    { headword: 'olá', definition: 'hello' },
    { headword: 'mundo', definition: 'world' },
    { headword: 'aprendizagem', definition: 'learning, study' },
  ]},
  { id: 'bundled-ru-en', language: 'ru', targetLanguage: 'en', entries: [
    { headword: 'привет', definition: 'hello' },
    { headword: 'мир', definition: 'world' },
    { headword: 'обучение', definition: 'learning, study' },
  ]},
  { id: 'bundled-it-en', language: 'it', targetLanguage: 'en', entries: [
    { headword: 'ciao', definition: 'hello' },
    { headword: 'mondo', definition: 'world' },
    { headword: 'apprendimento', definition: 'learning, study' },
  ]},
  { id: 'bundled-vi-en', language: 'vi', targetLanguage: 'en', entries: [
    { headword: 'xin chào', definition: 'hello' },
    { headword: 'thế giới', definition: 'world' },
    { headword: 'học tập', definition: 'learning, study' },
  ]},
];

async function gzip(data) {
  const chunks = [];
  const gzipStream = createGzip();
  const writer = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(chunk);
      callback();
    }
  });
  await pipeline(Readable.from(data), gzipStream, writer);
  return Buffer.concat(chunks);
}

async function build() {
  mkdirSync('public/dictionaries', { recursive: true });
  for (const stub of STUBS) {
    const json = JSON.stringify(stub.entries);
    const compressed = await gzip(json);
    writeFileSync(`public/dictionaries/${stub.id}.json.gz`, compressed);
    console.log(`${stub.id}: ${stub.entries.length} entries, ${(compressed.length / 1024).toFixed(1)} KB`);
  }
}

build().catch(e => { console.error(e); process.exit(1); });
