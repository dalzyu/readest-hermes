import { DocumentLoader } from '@/libs/document';
import { Book } from '@/types/book';
import { AppService } from '@/types/system';
import {
  getAudioSyncPackageFilename,
  getAudioSyncPackageProvenanceFilename,
  getAudioSyncPackageVersionDir,
} from '@/utils/book';
import { configureZip } from '@/utils/zip';
import * as CFI from 'foliate-js/epubcfi.js';

import {
  AUDIO_SYNC_EPUB3_FILENAME,
  AUDIO_SYNC_EPUB3_VERSION,
  AUDIO_SYNC_MAP_VERSION,
} from './constants';
import {
  AudioAlignmentReport,
  AudioSyncGeneratedPackage,
  AudioSyncMap,
  AudioSyncPackageValidation,
  AudioSyncPackageValidationDiagnostic,
  BookAudioAsset,
} from './types';

const EPUB_MEDIA_OVERLAY_GENERATOR = 'hermes/readest-epub3-media-overlays@v1';
const XHTML_NS = 'http://www.w3.org/1999/xhtml';
const OPF_NS = 'http://www.idpf.org/2007/opf';
const zipWriteOptions = {
  lastAccessDate: new Date(0),
  lastModDate: new Date(0),
};
const WORD_CONFIDENCE_THRESHOLD = 0.75;

type ManifestItemRecord = {
  id: string;
  href: string;
  path: string;
  element: Element;
};

type OverlayEntry = {
  id: string;
  sectionHref: string;
  cfiStart: string;
  cfiEnd: string;
  audioStartMs: number;
  audioEndMs: number;
  kind: 'word' | 'segment';
};

type BuiltPackage = {
  file: File;
  provenance: AudioSyncGeneratedPackage;
};

type ValidationSectionSpec = {
  fragmentIds: string[];
  overlayCount: number;
};

type PackageValidationSpec = {
  audioPackagePath: string;
  sections: Map<string, ValidationSectionSpec>;
};

function parseXml(text: string, mimeType: string): Document {
  const doc = new DOMParser().parseFromString(text, mimeType as DOMParserSupportedType);
  if (doc.getElementsByTagName('parsererror').length > 0) {
    throw new Error(`Failed to parse ${mimeType} document`);
  }
  return doc;
}

function serializeXml(doc: Document): string {
  return new XMLSerializer().serializeToString(doc);
}

function dirname(path: string): string {
  const index = path.lastIndexOf('/');
  return index >= 0 ? path.slice(0, index) : '';
}

function normalizeZipPath(path: string): string {
  return path.replace(/^\/+/, '');
}

function resolveZipPath(basePath: string, relativePath: string): string {
  const base = dirname(basePath);
  const baseHref = `https://readest.invalid/${base ? `${base}/` : ''}`;
  const resolved = new URL(relativePath, baseHref);
  return decodeURIComponent(normalizeZipPath(resolved.pathname));
}

function relativeZipPath(fromPath: string, toPath: string): string {
  const fromParts = dirname(fromPath).split('/').filter(Boolean);
  const toParts = toPath.split('/').filter(Boolean);
  while (fromParts.length > 0 && toParts.length > 0 && fromParts[0] === toParts[0]) {
    fromParts.shift();
    toParts.shift();
  }
  return `${'../'.repeat(fromParts.length)}${toParts.join('/')}`;
}

function getAudioMimeType(format: BookAudioAsset['format']): string {
  return format === 'mp3' ? 'audio/mpeg' : 'audio/mp4';
}

function formatClock(ms: number): string {
  return `${(ms / 1000).toFixed(3)}s`;
}

function normalizeSectionHref(href: string): string {
  return href.split('#')[0] || href;
}

function toLocalCfi(cfi: string): string {
  if (!cfi.startsWith('epubcfi(') || !cfi.endsWith(')')) {
    return cfi;
  }
  const inner = cfi.slice(8, -1);
  const bangIndex = inner.lastIndexOf('!');
  return bangIndex >= 0 ? `epubcfi(${inner.slice(bangIndex + 1)})` : cfi;
}

function resolvePointRange(doc: Document, cfi: string): Range {
  const range = CFI.toRange(doc, CFI.parse(toLocalCfi(cfi)));
  if (!range) {
    throw new Error(`Unable to resolve CFI ${cfi}`);
  }
  return range;
}

function resolveTargetRange(doc: Document, startCfi: string, endCfi: string): Range {
  const start = resolvePointRange(doc, startCfi);
  const end = resolvePointRange(doc, endCfi);
  const range = doc.createRange();
  range.setStart(start.startContainer, start.startOffset);
  range.setEnd(end.startContainer, end.startOffset);
  return range;
}

function sanitizeFragmentSegment(value: string): string {
  return (
    value
      .replace(/[^a-z0-9]+/gi, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase() || 'section'
  );
}

function makeFragmentId(sectionPath: string, entry: OverlayEntry, index: number): string {
  return `as-${sanitizeFragmentSegment(sectionPath)}-${entry.kind}-${index}`;
}

function nearestTargetElement(node: Node): Element | null {
  let current: Node | null = node.nodeType === Node.ELEMENT_NODE ? node : node.parentNode;
  while (current && current.nodeType === Node.ELEMENT_NODE) {
    const element = current as Element;
    if (
      element.tagName !== 'BODY' &&
      element.tagName !== 'HTML' &&
      (element.textContent || '').trim()
    ) {
      return element;
    }
    current = current.parentNode;
  }
  return null;
}

function wrapTextRange(doc: Document, range: Range, id: string): Element {
  const textNode = range.startContainer;
  if (
    textNode.nodeType !== Node.TEXT_NODE ||
    textNode !== range.endContainer ||
    range.startOffset === range.endOffset
  ) {
    throw new Error('Expected a non-empty single-text-node range');
  }

  const text = textNode as Text;
  const value = text.nodeValue || '';
  if (
    range.startOffset < 0 ||
    range.endOffset > value.length ||
    range.startOffset >= range.endOffset
  ) {
    throw new Error(
      `Invalid text range ${range.startOffset}-${range.endOffset} for node length ${value.length}`,
    );
  }

  const beforeText = value.slice(0, range.startOffset);
  const middleText = value.slice(range.startOffset, range.endOffset);
  const afterText = value.slice(range.endOffset);
  const fragment = doc.createDocumentFragment();

  if (beforeText) {
    fragment.appendChild(doc.createTextNode(beforeText));
  }

  const span = doc.createElementNS(XHTML_NS, 'span');
  span.setAttribute('id', id);
  span.setAttribute('cfi-inert', '');
  span.setAttribute('data-audio-sync', 'word');
  span.textContent = middleText;
  fragment.appendChild(span);

  if (afterText) {
    fragment.appendChild(doc.createTextNode(afterText));
  }

  text.parentNode?.replaceChild(fragment, text);
  return span;
}

function ensureFragmentTarget(doc: Document, entry: OverlayEntry, id: string): string | null {
  let range: Range;
  try {
    range = resolveTargetRange(doc, entry.cfiStart, entry.cfiEnd);
  } catch {
    return null;
  }

  if (entry.kind === 'word') {
    try {
      return wrapTextRange(doc, range, id).id;
    } catch {
      const fallback = nearestTargetElement(range.startContainer);
      if (!fallback) return null;
      if (!fallback.id) fallback.setAttribute('id', id);
      fallback.setAttribute('data-audio-sync', 'segment');
      return fallback.id;
    }
  }

  const element = nearestTargetElement(range.startContainer);
  if (!element) return null;
  if (!element.id) element.setAttribute('id', id);
  element.setAttribute('data-audio-sync', 'segment');
  return element.id;
}

function buildOverlayEntries(map: AudioSyncMap): Map<string, OverlayEntry[]> {
  const bySection = new Map<string, OverlayEntry[]>();
  for (const segment of map.segments) {
    const words = (segment.words || []).filter(
      (word) => word.confidence >= WORD_CONFIDENCE_THRESHOLD && word.audioEndMs > word.audioStartMs,
    );
    if (words.length > 0) {
      for (const word of words) {
        const sectionHref = normalizeSectionHref(word.sectionHref);
        const list = bySection.get(sectionHref) || [];
        list.push({
          id: word.id,
          sectionHref,
          cfiStart: word.cfiStart,
          cfiEnd: word.cfiEnd,
          audioStartMs: word.audioStartMs,
          audioEndMs: word.audioEndMs,
          kind: 'word',
        });
        bySection.set(sectionHref, list);
      }
      continue;
    }

    if (segment.audioEndMs <= segment.audioStartMs) {
      continue;
    }

    const sectionHref = normalizeSectionHref(segment.sectionHref);
    const list = bySection.get(sectionHref) || [];
    list.push({
      id: segment.id,
      sectionHref,
      cfiStart: segment.cfiStart,
      cfiEnd: segment.cfiEnd,
      audioStartMs: segment.audioStartMs,
      audioEndMs: segment.audioEndMs,
      kind: 'segment',
    });
    bySection.set(sectionHref, list);
  }

  for (const entries of bySection.values()) {
    entries.sort((left, right) => {
      const cfiOrder = CFI.compare(left.cfiStart, right.cfiStart);
      return cfiOrder || left.audioStartMs - right.audioStartMs;
    });
  }

  return bySection;
}

function getManifestItemRecords(opf: Document, opfPath: string): ManifestItemRecord[] {
  const manifest = opf.getElementsByTagNameNS(OPF_NS, 'manifest')[0];
  if (!manifest) {
    throw new Error('EPUB package is missing a manifest');
  }

  return Array.from(manifest.children)
    .filter((element) => element.localName === 'item')
    .map((element) => ({
      id: element.getAttribute('id') || '',
      href: element.getAttribute('href') || '',
      path: resolveZipPath(opfPath, element.getAttribute('href') || ''),
      element,
    }));
}

async function getSourceEntryMap(sourceFile: File) {
  await configureZip();
  const { BlobReader, BlobWriter, TextWriter, ZipReader } = await import('@zip.js/zip.js');
  const reader = new ZipReader(new BlobReader(sourceFile));
  const entries = await reader.getEntries();
  const byPath = new Map(
    entries.filter((entry) => !entry.directory).map((entry) => [entry.filename, entry]),
  );
  return {
    entries,
    readText: async (path: string) => {
      const entry = byPath.get(path);
      if (!entry) throw new Error(`Missing EPUB entry ${path}`);
      return (await entry.getData(new TextWriter())) as string;
    },
    readBlob: async (path: string, mimeType = 'application/octet-stream') => {
      const entry = byPath.get(path);
      if (!entry) throw new Error(`Missing EPUB entry ${path}`);
      return (await entry.getData(new BlobWriter(mimeType))) as Blob;
    },
  };
}

async function getOpfPath(readText: (path: string) => Promise<string>): Promise<string> {
  const container = parseXml(await readText('META-INF/container.xml'), 'application/xml');
  const rootfile = container.getElementsByTagName('rootfile')[0];
  const fullPath = rootfile?.getAttribute('full-path');
  if (!fullPath) {
    throw new Error('EPUB container is missing a rootfile');
  }
  return fullPath;
}

function buildValidation(
  valid: boolean,
  diagnostics: AudioSyncPackageValidationDiagnostic[],
): AudioSyncPackageValidation {
  return {
    valid,
    checkedAt: Date.now(),
    diagnostics,
  };
}

async function validateGeneratedPackage(
  file: File,
  validationSpec: PackageValidationSpec,
  diagnostics: AudioSyncPackageValidationDiagnostic[],
): Promise<AudioSyncPackageValidation> {
  try {
    const { entries, readText } = await getSourceEntryMap(file);
    const entryPaths = new Set(
      entries.filter((entry) => !entry.directory).map((entry) => entry.filename),
    );

    if (!entryPaths.has(validationSpec.audioPackagePath)) {
      diagnostics.push({
        code: 'missing-audio-entry',
        message: 'Generated EPUB package is missing the embedded audiobook file',
        severity: 'error',
        path: validationSpec.audioPackagePath,
      });
    }

    const opfPath = await getOpfPath(readText);
    const opf = parseXml(await readText(opfPath), 'application/xml');
    const manifestItems = getManifestItemRecords(opf, opfPath);
    const manifestByPath = new Map(manifestItems.map((item) => [item.path, item]));
    const manifestById = new Map(manifestItems.map((item) => [item.id, item]));

    for (const [sectionPath, sectionSpec] of validationSpec.sections.entries()) {
      const manifestItem = manifestByPath.get(sectionPath);
      if (!manifestItem) {
        diagnostics.push({
          code: 'missing-section-manifest-item',
          message: `Generated EPUB package is missing a manifest entry for ${sectionPath}`,
          severity: 'error',
          path: sectionPath,
        });
        continue;
      }

      if (!entryPaths.has(sectionPath)) {
        diagnostics.push({
          code: 'missing-section-entry',
          message: `Generated EPUB package is missing section content for ${sectionPath}`,
          severity: 'error',
          path: sectionPath,
        });
        continue;
      }

      const mediaOverlayId = manifestItem.element.getAttribute('media-overlay');
      if (!mediaOverlayId) {
        diagnostics.push({
          code: 'missing-media-overlay-manifest',
          message: `Generated section ${sectionPath} does not reference a SMIL overlay in the manifest`,
          severity: 'error',
          path: sectionPath,
        });
        continue;
      }

      const smilItem = manifestById.get(mediaOverlayId);
      if (!smilItem) {
        diagnostics.push({
          code: 'missing-smil-manifest-item',
          message: `Generated section ${sectionPath} references missing SMIL manifest item ${mediaOverlayId}`,
          severity: 'error',
          path: sectionPath,
        });
        continue;
      }

      if (!entryPaths.has(smilItem.path)) {
        diagnostics.push({
          code: 'missing-smil-entry',
          message: `Generated section ${sectionPath} references missing SMIL file ${smilItem.path}`,
          severity: 'error',
          path: smilItem.path,
        });
        continue;
      }

      const sectionDoc = parseXml(await readText(sectionPath), 'application/xhtml+xml');
      for (const fragmentId of sectionSpec.fragmentIds) {
        if (!sectionDoc.getElementById(fragmentId)) {
          diagnostics.push({
            code: 'missing-fragment-target',
            message: `Generated section ${sectionPath} is missing fragment target ${fragmentId}`,
            severity: 'error',
            path: `${sectionPath}#${fragmentId}`,
          });
        }
      }

      const smilDoc = parseXml(await readText(smilItem.path), 'application/xml');
      const pars = Array.from(smilDoc.getElementsByTagName('par'));
      if (pars.length !== sectionSpec.overlayCount) {
        diagnostics.push({
          code: 'unexpected-overlay-count',
          message: `Generated section ${sectionPath} expected ${sectionSpec.overlayCount} overlay entries but found ${pars.length}`,
          severity: 'error',
          path: smilItem.path,
        });
      }

      const referencedFragments = new Set<string>();
      for (const par of pars) {
        const text = par.getElementsByTagName('text')[0];
        if (!text) {
          diagnostics.push({
            code: 'missing-smil-text',
            message: `Generated SMIL ${smilItem.path} has an overlay entry without a text target`,
            severity: 'error',
            path: smilItem.path,
          });
        } else {
          const src = text.getAttribute('src') || '';
          const [textPath, fragmentId] = src.split('#');
          if (resolveZipPath(smilItem.path, textPath ?? '') !== sectionPath) {
            diagnostics.push({
              code: 'invalid-smil-text-src',
              message: `Generated SMIL ${smilItem.path} points at ${src} instead of ${sectionPath}`,
              severity: 'error',
              path: smilItem.path,
            });
          }
          if (!fragmentId) {
            diagnostics.push({
              code: 'missing-smil-fragment',
              message: `Generated SMIL ${smilItem.path} has a text target without a fragment id`,
              severity: 'error',
              path: smilItem.path,
            });
          } else {
            referencedFragments.add(fragmentId);
          }
        }

        const audio = par.getElementsByTagName('audio')[0];
        if (!audio) {
          diagnostics.push({
            code: 'missing-smil-audio',
            message: `Generated SMIL ${smilItem.path} has an overlay entry without an audio clip`,
            severity: 'error',
            path: smilItem.path,
          });
          continue;
        }

        const audioSrc = audio.getAttribute('src') || '';
        if (resolveZipPath(smilItem.path, audioSrc) !== validationSpec.audioPackagePath) {
          diagnostics.push({
            code: 'invalid-smil-audio-src',
            message: `Generated SMIL ${smilItem.path} points at ${audioSrc} instead of ${validationSpec.audioPackagePath}`,
            severity: 'error',
            path: smilItem.path,
          });
        }
        if (!audio.getAttribute('clipBegin') || !audio.getAttribute('clipEnd')) {
          diagnostics.push({
            code: 'missing-audio-clip-range',
            message: `Generated SMIL ${smilItem.path} is missing clip timing metadata`,
            severity: 'error',
            path: smilItem.path,
          });
        }
      }

      for (const fragmentId of sectionSpec.fragmentIds) {
        if (!referencedFragments.has(fragmentId)) {
          diagnostics.push({
            code: 'missing-smil-target-ref',
            message: `Generated SMIL ${smilItem.path} is missing a reference to fragment ${fragmentId}`,
            severity: 'error',
            path: `${smilItem.path}#${fragmentId}`,
          });
        }
      }
    }
  } catch (error) {
    diagnostics.push({
      code: 'package-structure-validation-failed',
      message:
        error instanceof Error
          ? error.message
          : 'Failed to validate generated EPUB package structure',
      severity: 'error',
    });
  }

  try {
    const { book } = await new DocumentLoader(file).open();
    const loadedSections = new Set<string>();
    for (const section of book.sections as Array<{ id: string; mediaOverlay?: unknown }>) {
      if (!validationSpec.sections.has(section.id)) {
        continue;
      }
      loadedSections.add(section.id);
      if (!section.mediaOverlay) {
        diagnostics.push({
          code: 'missing-media-overlay',
          message: `Generated section ${section.id} is missing media overlay metadata`,
          severity: 'error',
          path: section.id,
        });
      }
    }

    for (const sectionPath of validationSpec.sections.keys()) {
      if (!loadedSections.has(sectionPath)) {
        diagnostics.push({
          code: 'missing-loaded-section',
          message: `Generated section ${sectionPath} could not be loaded back from the EPUB package`,
          severity: 'error',
          path: sectionPath,
        });
      }
    }
  } catch (error) {
    diagnostics.push({
      code: 'loader-open-failed',
      message: error instanceof Error ? error.message : 'Failed to load generated EPUB package',
      severity: 'error',
    });
  }

  return buildValidation(
    !diagnostics.some((diagnostic) => diagnostic.severity === 'error'),
    diagnostics,
  );
}

export async function createEpubMediaOverlayPackage(input: {
  book: Book;
  sourceFile: File;
  audioFile: File;
  asset: BookAudioAsset;
  map: AudioSyncMap;
  report?: AudioAlignmentReport | null;
  packagePath?: string;
}): Promise<BuiltPackage> {
  if (input.book.format !== 'EPUB') {
    throw new Error('EPUB3 media overlay generation only supports EPUB sources');
  }
  if (input.map.version !== AUDIO_SYNC_MAP_VERSION) {
    throw new Error(`Expected sync-map.v${AUDIO_SYNC_MAP_VERSION}.json before package generation`);
  }

  const diagnostics: AudioSyncPackageValidationDiagnostic[] = [];
  const overlayEntries = buildOverlayEntries(input.map);
  const { entries, readBlob, readText } = await getSourceEntryMap(input.sourceFile);
  const opfPath = await getOpfPath(readText);
  const opf = parseXml(await readText(opfPath), 'application/xml');
  const manifest = opf.getElementsByTagNameNS(OPF_NS, 'manifest')[0];
  const metadata = opf.getElementsByTagNameNS(OPF_NS, 'metadata')[0];

  if (!manifest || !metadata) {
    throw new Error('EPUB package is missing required OPF sections');
  }

  const manifestItems = getManifestItemRecords(opf, opfPath);
  const manifestByPath = new Map(manifestItems.map((item) => [item.path, item]));
  const replacements = new Map<string, string>();
  const smilEntries = new Map<string, string>();
  const validationSections = new Map<string, ValidationSectionSpec>();
  const audioPackagePath = resolveZipPath(
    opfPath,
    `audio/asset.${input.asset.normalizedFormat || input.asset.format}`,
  );
  let mediaOverlayIndex = 0;

  for (const [sectionPath, entriesForSection] of overlayEntries.entries()) {
    const manifestItem = manifestByPath.get(sectionPath);
    if (!manifestItem) {
      diagnostics.push({
        code: 'missing-section-manifest-item',
        message: `Unable to locate manifest entry for synced section ${sectionPath}`,
        severity: 'error',
        path: sectionPath,
      });
      continue;
    }

    const sectionDoc = parseXml(await readText(sectionPath), 'application/xhtml+xml');
    const fragmentTargets = entriesForSection.map((entry, index) => ({
      entry,
      index,
      fragmentId: '',
    }));
    for (const target of [...fragmentTargets].reverse()) {
      target.fragmentId =
        ensureFragmentTarget(
          sectionDoc,
          target.entry,
          makeFragmentId(sectionPath, target.entry, target.index),
        ) || '';
    }
    replacements.set(sectionPath, serializeXml(sectionDoc));

    const smilPath = resolveZipPath(opfPath, `smil/${sanitizeFragmentSegment(sectionPath)}.smil`);
    const smilId = `mo-${manifestItem.id || sanitizeFragmentSegment(sectionPath)}-${mediaOverlayIndex}`;
    mediaOverlayIndex += 1;
    const smilDoc = parseXml(
      `<smil xmlns="http://www.w3.org/ns/SMIL" version="3.0"><body><seq/></body></smil>`,
      'application/xml',
    );
    const seq = smilDoc.getElementsByTagName('seq')[0]!;
    const validFragmentIds: string[] = [];

    for (const { entry, fragmentId } of fragmentTargets) {
      if (!fragmentId) continue;
      if (
        entry.audioStartMs < 0 ||
        entry.audioEndMs <= entry.audioStartMs ||
        (input.asset.durationMs != null && entry.audioEndMs > input.asset.durationMs)
      ) {
        diagnostics.push({
          code: 'invalid-audio-clip',
          message: `Invalid clip range for ${entry.id}`,
          severity: 'error',
          path: sectionPath,
        });
        continue;
      }

      const par = smilDoc.createElementNS(smilDoc.documentElement.namespaceURI, 'par');
      par.setAttribute('id', `${smilId}-${entry.id}`);

      const text = smilDoc.createElementNS(smilDoc.documentElement.namespaceURI, 'text');
      text.setAttribute('src', `${relativeZipPath(smilPath, sectionPath)}#${fragmentId}`);
      par.appendChild(text);

      const audio = smilDoc.createElementNS(smilDoc.documentElement.namespaceURI, 'audio');
      audio.setAttribute('src', relativeZipPath(smilPath, audioPackagePath));
      audio.setAttribute('clipBegin', formatClock(entry.audioStartMs));
      audio.setAttribute('clipEnd', formatClock(entry.audioEndMs));
      par.appendChild(audio);
      seq.appendChild(par);
      validFragmentIds.push(fragmentId);
    }

    if (validFragmentIds.length === 0) {
      diagnostics.push({
        code: 'empty-media-overlay-section',
        message: `Generated section ${sectionPath} does not contain any valid overlay entries`,
        severity: 'error',
        path: sectionPath,
      });
    }

    smilEntries.set(smilPath, serializeXml(smilDoc));
    validationSections.set(sectionPath, {
      fragmentIds: validFragmentIds,
      overlayCount: validFragmentIds.length,
    });

    const existingOverlay = manifestItem.element.getAttribute('media-overlay');
    const finalSmilId = existingOverlay || smilId;
    manifestItem.element.setAttribute('media-overlay', finalSmilId);

    if (!existingOverlay) {
      const item = opf.createElementNS(OPF_NS, 'item');
      item.setAttribute('id', finalSmilId);
      item.setAttribute('href', relativeZipPath(opfPath, smilPath));
      item.setAttribute('media-type', 'application/smil+xml');
      manifest.appendChild(item);
    }
  }

  const audioItem = opf.createElementNS(OPF_NS, 'item');
  audioItem.setAttribute('id', 'as-audio');
  audioItem.setAttribute('href', relativeZipPath(opfPath, audioPackagePath));
  audioItem.setAttribute(
    'media-type',
    getAudioMimeType(input.asset.normalizedFormat || input.asset.format),
  );
  manifest.appendChild(audioItem);

  const durationMeta = opf.createElementNS(OPF_NS, 'meta');
  durationMeta.setAttribute('property', 'media:duration');
  durationMeta.textContent = formatClock(input.asset.durationMs || 0);
  metadata.appendChild(durationMeta);

  const activeClassMeta = opf.createElementNS(OPF_NS, 'meta');
  activeClassMeta.setAttribute('property', 'media:active-class');
  activeClassMeta.textContent = 'readest-audio-sync-active';
  metadata.appendChild(activeClassMeta);

  const playbackClassMeta = opf.createElementNS(OPF_NS, 'meta');
  playbackClassMeta.setAttribute('property', 'media:playback-active-class');
  playbackClassMeta.textContent = 'readest-audio-sync-playing';
  metadata.appendChild(playbackClassMeta);

  replacements.set(opfPath, serializeXml(opf));

  await configureZip();
  const { BlobReader, BlobWriter, TextReader, ZipWriter } = await import('@zip.js/zip.js');
  const writer = new ZipWriter(new BlobWriter('application/epub+zip'), {
    extendedTimestamp: false,
  });

  await writer.add('mimetype', new TextReader('application/epub+zip'), zipWriteOptions);
  for (const entry of entries) {
    if (entry.directory || entry.filename === 'mimetype') {
      continue;
    }
    if (entry.filename === audioPackagePath) {
      continue;
    }
    if (replacements.has(entry.filename)) {
      await writer.add(
        entry.filename,
        new TextReader(replacements.get(entry.filename)!),
        zipWriteOptions,
      );
      continue;
    }
    const data = await readBlob(entry.filename);
    await writer.add(entry.filename, new BlobReader(data), zipWriteOptions);
  }

  for (const [path, content] of smilEntries.entries()) {
    await writer.add(path, new TextReader(content), zipWriteOptions);
  }

  await writer.add(audioPackagePath, new BlobReader(input.audioFile), zipWriteOptions);
  const blob = await writer.close();
  const file = new File([blob], AUDIO_SYNC_EPUB3_FILENAME, { type: 'application/epub+zip' });
  const validation = await validateGeneratedPackage(
    file,
    {
      audioPackagePath,
      sections: validationSections,
    },
    diagnostics,
  );
  const now = Date.now();

  return {
    file,
    provenance: {
      version: AUDIO_SYNC_EPUB3_VERSION,
      generator: EPUB_MEDIA_OVERLAY_GENERATOR,
      bookHash: input.book.hash,
      audioHash: input.asset.audioHash,
      syncMapId: input.map.id,
      syncMapVersion: input.map.version,
      packagePath:
        input.packagePath || getAudioSyncPackageFilename(input.book, AUDIO_SYNC_EPUB3_VERSION),
      audioPath: audioPackagePath,
      audioFileName: input.audioFile.name,
      sizeBytes: file.size,
      createdAt: now,
      updatedAt: now,
      report: input.report
        ? {
            runId: input.report.runId,
            phase: input.report.phase,
            model: input.report.model,
            device: input.report.device,
            warnings: input.report.warnings,
            errors: input.report.errors,
          }
        : undefined,
      validation,
    },
  };
}

export async function generateEpubMediaOverlayPackage(
  appService: AppService,
  book: Book,
  asset: BookAudioAsset,
  map: AudioSyncMap,
  report?: AudioAlignmentReport | null,
): Promise<AudioSyncGeneratedPackage> {
  const { file: sourceFile } = await appService.loadBookContent(book, {
    preferGeneratedPackage: false,
  });
  const audioPath = asset.normalizedPath || asset.originalPath;
  const audioFile = await appService.openFile(audioPath, 'Books');
  const packagePath = getAudioSyncPackageFilename(book);
  const provenancePath = getAudioSyncPackageProvenanceFilename(book);
  const result = await createEpubMediaOverlayPackage({
    book,
    sourceFile,
    audioFile,
    asset,
    map,
    report,
    packagePath,
  });

  if (!result.provenance.validation.valid) {
    throw new Error(
      result.provenance.validation.diagnostics
        .filter((diagnostic) => diagnostic.severity === 'error')
        .map((diagnostic) => diagnostic.message)
        .join('; ') || 'Generated EPUB3 media overlay package failed validation',
    );
  }

  await appService.createDir(getAudioSyncPackageVersionDir(book), 'Books', true);
  await appService.writeFile(packagePath, 'Books', result.file);
  await appService.writeFile(provenancePath, 'Books', JSON.stringify(result.provenance, null, 2));
  return result.provenance;
}
