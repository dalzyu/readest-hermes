# Hermes 0.1.0 Release Plan

## Goal
Ship Hermes 0.1.0 — the first minor release signaling a feature-complete, polished fork of Readest. Targets: Windows (x64/arm64), macOS (universal), Linux (x64), Android (APK, no Play Store). **Offline-only** — no cloud backend for this release. Full branding cleanup, existing TODO/FIXME polish, test hardening, CI pipeline fixes, and an ambitious offline feature slate: spaced-repetition vocabulary review, lookup history, Japanese furigana, reading session stats, streaks/goals, AI chapter recap, focus mode, and PKM export templates.

## Current State
- **Version**: Frontend `0.0.2`, Rust crate `0.2.2` (mismatch)
- **Branch**: `codex`, 13 commits ahead of `origin/main`
- **Submodules**: `packages/qcms` registered but uninitialized (prefix `-` in `git submodule status`)
- **CI**: PR checks work; release workflow has non-standard ARM runner references and Fastlane is disconnected
- **Branding**: ~95% complete. Stale translation keys in 32 locales, OPDS user-agent says `Readest/1.0`, SECURITY.md references upstream
- **Known issues**: ~15 TODO/FIXME items across the codebase
- **Cloud features**: Hermes 0.1.0 is offline-only. Cloud sync, account login, cloud storage, and premium upgrade UI elements need to be hidden or gracefully disabled.
- **Release posture**: no feature cuts. If the full 0.1.0 slate is not solid, move the release date instead of shipping a trimmed release.
- **Commit policy**: after every major change set, run the targeted verification for that slice and create a git commit before starting the next major slice. Treat commits as review checkpoints, not end-of-day cleanup.

---

## Phase 1: Version & Metadata Alignment

### 1.1 Unify version numbers
- **File**: `apps/readest-app/package.json` — bump `version` from `0.0.2` to `0.1.0`
- **File**: `apps/readest-app/src-tauri/Cargo.toml` — change `version` from `0.2.2` to `0.1.0`
  - Tauri reads the JS version via `../package.json` reference in `tauri.conf.json`, but the Cargo.toml version should match for consistency
- **File**: `apps/readest-app/release-notes.json` — add `0.1.0` entry with release notes

### 1.2 Rust crate metadata
- **File**: `apps/readest-app/src-tauri/Cargo.toml`
  - `name = "Readest"` → `name = "Hermes"` (or keep as internal crate name if it would break Tauri integration — verify `cargo clippy -p Readest` in CI)
  - `description` → update to Hermes description
  - `repository` → point to `https://github.com/dalzyu/readest-hermes`
  - **Verification**: Check if renaming the crate breaks `cargo clippy -p Readest` in `pull-request.yml`, the `readestlib` lib name, or any Tauri plugin references. If it does, leave `name` alone and only update `description`/`repository`.

### 1.3 Submodule: qcms
- `packages/qcms` is registered in `.gitmodules` but never initialized. Determine if it's used. If not, remove from `.gitmodules` and clean up. If used, initialize it.
- **Check**: `grep -r "qcms" apps/ packages/ Cargo.toml Cargo.lock` to see if anything references it.

---

## Phase 2: Full Branding Cleanup

### 2.1 Constants & user-agent
- **File**: `apps/readest-app/src/services/constants.ts`
  - `DOWNLOAD_READEST_URL` (line 709): Point to `https://github.com/dalzyu/readest-hermes/releases/latest` instead of `readest.com`
  - `READEST_OPDS_USER_AGENT` (line 723): `'Readest/1.0 (OPDS Browser)'` → `'Hermes/0.1 (OPDS Browser)'`
  - `READEST_WEB_BASE_URL`, `READEST_NODE_BASE_URL`, `READEST_PUBLIC_STORAGE_BASE_URL` (lines 711-712, 721): **Leave as-is for now**. These are dead code in offline mode. They won't be called since cloud features are disabled. Removing them would cascade to many import sites — unnecessary churn for 0.1.0.
  - Variable names like `READEST_*` stay as internal identifiers (not user-facing).

### 2.6 Disable cloud-dependent UI (offline-only mode)
Since Hermes 0.1.0 has no cloud backend, the following UI elements must be hidden or disabled:

| UI Element | File | Action |
|---|---|---|
| "Sign In" menu item | `src/app/library/components/SettingsMenu.tsx` | Hide when no backend configured |
| "Upgrade to Hermes Premium" menu item | `src/app/library/components/SettingsMenu.tsx` | Hide when no backend configured |
| Cloud sync status/button | `src/app/library/components/SettingsMenu.tsx` | Hide sync indicators |
| "Account" menu item | `src/app/library/components/SettingsMenu.tsx` | Hide when no user |
| "DeepL requires a Hermes account" message | `src/components/settings/AITranslatePanel.tsx` | Change to "DeepL requires your own API key" or similar |
| Sync settings panels (KOReader, Readwise, Hardcover) | `src/components/settings/` | Keep visible but document that sync requires self-hosted backend (Docker) |

**Implementation approach**: Add a feature flag constant (e.g. `CLOUD_ENABLED = false`) in `constants.ts`. Gate cloud UI on this flag. This is clean, reversible, and makes re-enabling trivial when a backend is available.

**Key constraint**: OPDS catalog browsing, local AI (Ollama), local TTS, and all offline reading features must remain fully functional. Only cloud-dependent features (sync, accounts, premium) are affected.

### 2.2 Translation keys — stale cleanup
- **32 locale files** in `apps/readest-app/public/locales/*/translation.json` contain orphaned keys:
  - `"About Readest"`, `"Download Readest"`, `"Upgrade to Readest Premium"`, `"support@readest.com"`, etc.
- These keys are no longer referenced in code (the code now uses `"About Hermes"`, etc.), but they clutter the files.
- **Action**: Remove stale `*Readest*` keys from all 32 translation files. Can be parallelized across files.
- **Verification**: Run `pnpm i18n:extract` to regenerate keys from source, then diff against current translation files to confirm no active key references "Readest".

### 2.3 SECURITY.md
- **File**: `SECURITY.md`
  - Line 7: "Readest is a cross-platform e-reader" → "Hermes is a cross-platform e-reader"
  - Line 63: "outside of Readest's control" → "outside of Hermes's control"
  - Line 69: "Readest does not currently maintain..." → "Hermes does not currently maintain..."
  - Lines 73–74: Update supported version table to `0.1.x` instead of `0.10.x`
  - Line 83: Update vulnerability reporting URL from `readest/readest` to `dalzyu/readest-hermes`
  - Keep upstream attribution where appropriate.

### 2.4 data/metainfo/appdata.xml
- **File**: `data/metainfo/appdata.xml`
  - Screenshot URLs referencing `readest/readest` repo → update to `dalzyu/readest-hermes` or remove if screenshots aren't published yet
  - Help/donation URLs pointing to `readest.io` — keep as upstream attribution? Or update?

### 2.5 README.md
- Currently describes upstream Readest. Needs Hermes-specific introduction or at minimum a prominent "This is the Hermes fork" section.
- Update any download/install links to point to Hermes releases.

---

## Phase 3: Technical Debt & Bug Fixes

Priority: Fix items that affect user experience. Skip platform-specific items for platforms not in scope (iOS).

### 3.1 Actionable FIXMEs (in scope)

| # | File | Issue | Action |
|---|---|---|---|
| 1 | `src/hooks/useShortcuts.ts:57` | Temporary fix disabling Back button navigation | Investigate and implement proper fix or document as known limitation |
| 2 | `src/hooks/useTheme.ts:91` | iPhone landscape system UI workaround | Out of scope (iOS) — leave as-is |
| 3 | `src/hooks/useOpenWithBooks.ts:110` | iOS plugin listener freeze | Out of scope (iOS) — leave as-is |
| 4 | `src/app/reader/hooks/useTextSelector.ts:71` | iOS selection tools dismissal hack | Out of scope (iOS) — leave as-is |
| 5 | `src/app/reader/hooks/useTextSelector.ts:223-224` | Cross-page text selection workaround + TODO | Document as known limitation for 0.1.0 |
| 6 | `src/services/tts/TTSController.ts:62` | Native TTS not implemented for PC | Document as known limitation |
| 7 | `src/services/tts/TTSController.ts:327` | End-of-book TTS handling | Fix: detect end-of-book and stop TTS gracefully |
| 8 | `src/services/bookService.ts` | 0.9.64 filename-not-updated bug | Investigate if still relevant — the version is old |
| 9 | `src/utils/file.ts:339` | Android HEAD request not supported | In scope (Android APK target) — investigate fix |
| 10 | `src/store/readerStore.ts:214` | metaHash verification blocked | Investigate blocker status |
| 11 | `src/services/nativeAppService.ts` | NativeFile switch pending bug fix | Investigate current status |
| 12 | `src/services/commandRegistry.ts:652` | Reader-specific actions not in command registry | Nice-to-have: add TTS, bookmark commands |
| 13 | `src/utils/storage.ts:4` | Storage type exposed to client | Low priority — type-level cleanup |
| 14 | `pages/api/deepl/translate.ts:188` | Server-side translation processing should move to client | Low priority — works as-is |
| 15 | `pages/api/sync.ts:121` | Hotfix for initial race condition | Investigate if still needed |

### 3.2 Priority fixes for 0.1.0
Focus on items **1, 7, 8, 9, 10, 11, 15** — these affect desktop and Android users.

### 3.3 New Feature Slate for 0.1.0

> Decision: user wants all brainstormed features. Recommended approach is to implement them as **local-first features built on existing infrastructure**, not as net-new subsystems. That keeps the scope adventurous but still coherent.

#### 3.3.1 Vocabulary & Learning

1. **Vocabulary Flashcard Review**
   - Existing foundation: `VocabularyEntry` already stores `addedAt`, `reviewCount`, `examples`, language pair, and rich LLM output; `reviewCount` is currently always `0`.
   - Recommended approach: extend `VocabularyEntry` with `dueAt`, `intervalDays`, `easeFactor`, `repetition`, and `lastReviewedAt`; bump `aiStore` DB version and add a `dueAt` index.
   - UI approach: add one new top-level Notebook tab, `review`, for the active review queue. Keep lookup history inside the existing Vocabulary panel instead of creating another top-level tab.
   - Scheduling approach: implement **SM-2 locally** instead of adding a package. The official SuperMemo SM-2 description is simple, stable, and keeps the app offline-first.

2. **Lookup History**
   - Existing gap: only explicit saves create `VocabularyEntry`; ordinary lookups disappear.
   - Recommended approach: add a dedicated local history store keyed by `bookHash`, `lookedUpAt`, and `term`. Do **not** overload `VocabularyEntry` — saved vocabulary and passive history are different concepts.
   - UI approach: extend `VocabularyPanel` with a segmented control or secondary tab for `Saved` vs `History`.

3. **Japanese Furigana / Readings**
   - Existing foundation: `jaPlugin.ts` exists but is a stub; plugin registry and annotation plumbing already work for `zhPlugin`.
   - Recommended approach: replace the handwritten kana-only map with `wanakana`-based phonetic enrichment. First deliverable is accurate hiragana/romaji for kana and lightweight phonetic support for Japanese text in the popup. Avoid heavy analyzers unless `wanakana` proves insufficient.
   - Verification note: this feature must not regress `zhPlugin` or the shared plugin interface.

#### 3.3.2 Reading Intelligence

4. **Reading Session Tracker**
   - Existing gap: Hermes persists only per-book progress/location and no aggregate reading analytics.
   - Recommended approach: create a dedicated local reading-stats store/service rather than stuffing session history into `BookConfig`. Track `startedAt`, `endedAt`, `secondsRead`, `pageDelta`, `bookHash`, and `calendarDate` per session.
   - Rationale: streaks, goals, and dashboards are aggregate concerns. A separate store keeps book config simple and makes library-wide analytics cheap to compute.

5. **Reading Streaks & Goals**
   - Dependency: built on top of the session tracker.
   - Recommended approach: support daily time goal and daily page goal first. Derive streaks from days that meet a minimal threshold rather than from raw app opens.
   - UI approach: add a compact stats card in the library view instead of inventing a separate dashboard route for 0.1.0.

6. **AI Chapter Recap**
   - Existing foundation: Hermes already has spoiler-bounded RAG search (`maxPage`) and a book-aware chat adapter.
   - Recommended approach: add a `Recap so far` action in the AI notebook and/or reader chrome. Reuse the existing bounded retrieval path so recap content is capped at the current page.
   - Prompting approach: treat recap as a specialized system prompt variant, not a separate AI subsystem.

#### 3.3.3 Reader UX & Knowledge Export

7. **Focus / Zen Mode**
   - Existing gap: there is fullscreen but no true distraction-free reading mode.
   - Recommended approach: add one reader state that hides header, footer, and sidebar chrome together while preserving a clear escape hatch (shortcut, tap/click reveal, or `Esc`).
   - Constraint: accessibility must stay intact — do not strand keyboard users in a hidden UI state.

8. **Obsidian / Notion Export Templates**
   - Existing foundation: annotation export already uses Nunjucks templates and custom formatting.
   - Recommended approach: ship 2-3 bundled templates selectable from `ExportMarkdownDialog` rather than inventing a new export pipeline. Start with `Obsidian Markdown`, `Notion Markdown`, and `Study Notes` presets.
   - Constraint: keep custom-template editing intact; presets are shortcuts, not a replacement.

#### 3.3.4 Dependency Order & Parallelization

- **Foundation first**: session tracker before streaks/goals; vocabulary schema/store upgrade before review queue; plugin replacement before popup tests are updated.
- **Parallelizable**: furigana, recap, focus mode, export templates, and lookup history can be built independently once their target files are identified.
- **Recommended sequencing**:
  1. Vocabulary schema + aiStore upgrade
  2. Session tracker data model
  3. Review queue UI + SM-2
  4. Streaks/goals UI
  5. Lookup history
  6. Furigana plugin
  7. AI recap
  8. Focus mode
  9. Export templates

---

## Phase 4: Test Hardening

### 4.1 Update existing branding tests
- **File**: `src/__tests__/services/build/hermes-branding.test.ts`
  - Extend to verify OPDS user-agent, SECURITY.md, and translation file cleanup
  - Add assertion that no `translation.json` file contains `"About Readest"` or `"Upgrade to Readest Premium"` keys

### 4.2 Update workflow alignment tests
- **File**: `src/__tests__/services/build/workflow-alignment.test.ts`
  - Update version expectations to `0.1.0`
  - Add assertion for Cargo.toml version alignment

### 4.3 Version alignment test
- Add test that verifies `package.json` version, `Cargo.toml` version, and `release-notes.json` all have the same version entry.

### 4.4 Run existing test suite
- `pnpm test -- --watch=false` — all unit tests must pass
- `pnpm test:browser` — all browser tests must pass
- `pnpm lint` — zero warnings/errors
- `pnpm fmt:check` — formatting clean
- `pnpm clippy:check` — no warnings

---

## Phase 5: CI/CD Pipeline Fixes

### 5.1 Release workflow — remove non-target platforms
- **File**: `.github/workflows/release.yml`
  - Remove or disable `ubuntu-22.04-arm` matrix entries (aarch64 and armhf Linux) — these require self-hosted runners not available
  - Keep: Android (ubuntu-latest), Linux x64 (ubuntu-22.04), macOS (macos-latest), Windows x64 + arm64 (windows-latest)
  - **Result**: 5 matrix entries instead of 7

### 5.2 Release workflow — verify fork path
- The workflow gates on `github.repository == 'readest/readest'` for signing. Verify the else-branch (fork path) correctly:
  - Builds unsigned APK for Android
  - Builds unsigned NSIS for Windows
  - Builds unsigned AppImage for Linux
  - Builds unsigned .app for macOS
  - Uploads all artifacts to GitHub Release

### 5.3 PR workflow — add format/lint to Tauri job
- **File**: `.github/workflows/pull-request.yml`
  - The `build_tauri_app` job only runs tests. Add `pnpm format:check` and `pnpm lint` to match the web job coverage.

### 5.4 Verify release-notes.json parsing
- The release workflow parses `release-notes.json` to generate the release body. Verify the 0.1.0 entry is correctly formatted and the parser handles it.

---

## Phase 6: Documentation Updates

### 6.1 Release notes
- **File**: `apps/readest-app/release-notes.json`
  - Add `0.1.0` entry summarizing all changes since 0.0.1 (branding, popup refactor, translation cleanup, bug fixes, version alignment)

### 6.2 README.md
- Add Hermes-specific header/description
- Update installation instructions to reference Hermes GitHub releases
- Keep upstream attribution section

### 6.3 CONTRIBUTING.md
- Review for any Hermes-specific changes needed (repo URL, setup instructions)

---

## Phase 7: Release Preparation

### 7.1 Final version bump
- All version numbers set to `0.1.0` (Phase 1)
- Release notes populated (Phase 6)

### 7.2 Pre-release checklist
- [ ] All tests pass (`pnpm test -- --watch=false && pnpm test:browser`)
- [ ] Lint clean (`pnpm lint`)
- [ ] Format clean (`pnpm format:check`)
- [ ] Rust lint clean (`pnpm clippy:check && pnpm fmt:check`)
- [ ] No stale "Readest" user-facing strings (branding test validates)
- [ ] Version numbers aligned across package.json, Cargo.toml, release-notes.json
- [ ] Cloud UI elements hidden (Sign In, Premium, Sync status not visible)
- [ ] OPDS browsing, local AI, TTS, and offline reading still functional
- [ ] `pnpm build` succeeds (production Next.js build)
- [ ] CI pipeline tested (push to branch, verify PR checks pass)
- [ ] Full feature slate complete; if not, delay 0.1.0 instead of cutting scope silently

### 7.3 Merge strategy
- Squash-merge `codex` → `main` or create a PR from `codex` → `main`
- Tag `v0.1.0` on main
- Push tag to trigger release workflow

### 7.4 Clean up stale branches
- Delete `backup/*` branches (already merged into `codex`)
- Delete `feat` branch (tracks `origin/main`, unused)

---

## Execution Order

Phases can be parallelized as follows:

```
Phase 1 (Version)      ──┐
Phase 2 (Branding)     ──┤── Can run in parallel
Phase 3 (Fixes+Features) ─┘
        │
        ├─ Vocabulary branch: schema/store → review queue → history
        ├─ Reading branch: session tracker → streaks/goals → library stats card
        └─ Independent branch: furigana, AI recap, focus mode, export templates
        │
        ▼
Phase 4 (Tests)        ── Depends on Phase 3 behavior landing
        │
        ▼
Phase 5 (CI/CD)        ── Can run in parallel with late test work
        │
        ▼
Phase 6 (Docs)         ── Depends on final shipped feature set being known
        │
        ▼
Phase 7 (Release)      ── Final step, everything must be done
```

### Commit Cadence During Execution

Each of the following is a **major change** and should end with targeted verification plus a commit before moving on:

1. Version + metadata alignment
2. Branding cleanup + offline cloud gating
3. Vocabulary schema/store upgrade
4. Review queue + SM-2 behavior
5. Lookup history
6. Reading session tracker
7. Streaks/goals + library stats card
8. Japanese furigana plugin
9. AI recap
10. Focus mode
11. Export template presets
12. CI/workflow updates
13. Docs + release notes

Recommended rhythm for the implementation session: change → run the narrowest meaningful verification → commit → continue. Do **not** batch the whole release into one giant commit.

## Key Files to Modify

| File | Phase | Changes |
|------|-------|---------|
| `apps/readest-app/package.json` | 1, 3 | Version bump to 0.1.0; likely add `wanakana` if chosen for jaPlugin |
| `apps/readest-app/src-tauri/Cargo.toml` | 1, 2 | Version + metadata |
| `apps/readest-app/src/services/constants.ts` | 2, 3 | User-agent, URLs, CLOUD_ENABLED flag, feature defaults if needed |
| `apps/readest-app/src/app/library/components/SettingsMenu.tsx` | 2 | Gate cloud UI on CLOUD_ENABLED |
| `apps/readest-app/src/components/settings/AITranslatePanel.tsx` | 2 | Fix DeepL account message |
| `apps/readest-app/src/services/contextTranslation/types.ts` | 3 | Extend `VocabularyEntry` and related lookup/history types |
| `apps/readest-app/src/services/contextTranslation/vocabularyService.ts` | 3 | SM-2 scheduling helpers, review queue queries, history helpers, export support |
| `apps/readest-app/src/services/ai/storage/aiStore.ts` | 3 | DB version bump, `dueAt` index, lookup history store/indexes |
| `apps/readest-app/src/store/notebookStore.ts` | 3 | Add `review` tab state |
| `apps/readest-app/src/app/reader/components/notebook/Notebook.tsx` | 3 | Render review queue and updated vocabulary/history UI |
| `apps/readest-app/src/app/reader/components/notebook/VocabularyPanel.tsx` | 3 | Saved/history views, export affordances |
| `apps/readest-app/src/services/contextTranslation/plugins/jaPlugin.ts` | 3 | Replace kana-only stub with proper phonetic enrichment |
| `apps/readest-app/src/services/contextTranslation/plugins/types.ts` | 3 | Adjust plugin typing if furigana/readings need richer annotations |
| `apps/readest-app/src/app/reader/components/notebook/AIAssistant.tsx` | 3 | Add `Recap so far` entry point |
| `apps/readest-app/src/services/ai/prompts.ts` | 3 | Add recap-oriented system prompt variant if needed |
| `apps/readest-app/src/store/readerStore.ts` | 3 | Reader lifecycle hooks for session tracking and focus mode state |
| `apps/readest-app/src/types/book.ts` | 3 | Extend persisted types only if book-level analytics metadata is required |
| `apps/readest-app/src/app/library/components/` | 3 | Add compact stats/streaks/goals UI to library view |
| `apps/readest-app/src/app/reader/components/HeaderBar.tsx` | 3 | Respect focus mode chrome hiding |
| `apps/readest-app/src/app/reader/components/footerbar/FooterBar.tsx` | 3 | Respect focus mode chrome hiding |
| `apps/readest-app/src/app/reader/components/sidebar/SideBar.tsx` | 3 | Respect focus mode chrome hiding |
| `apps/readest-app/src/hooks/useShortcuts.ts` | 3 | Add focus mode shortcut and preserve escape hatch |
| `apps/readest-app/src/app/reader/components/annotator/ExportMarkdownDialog.tsx` | 3 | Add preset export templates |
| `apps/readest-app/src/utils/note.ts` | 3 | Keep preset/template rendering coherent |
| `apps/readest-app/public/locales/*/translation.json` (×32) | 2 | Remove stale keys |
| `apps/readest-app/release-notes.json` | 1, 6 | Add 0.1.0 entry |
| `SECURITY.md` | 2 | Rebrand to Hermes |
| `data/metainfo/appdata.xml` | 2 | Update URLs |
| `README.md` | 6 | Add Hermes description |
| `.github/workflows/release.yml` | 5 | Remove ARM Linux targets |
| `.github/workflows/pull-request.yml` | 5 | Add lint to Tauri job |
| `src/__tests__/services/build/hermes-branding.test.ts` | 4 | Extend assertions |
| `src/__tests__/services/build/workflow-alignment.test.ts` | 4 | Version assertions |
| Feature-specific test files under `src/__tests__/` | 4 | Add behavioral coverage for SRS, history, recap, focus mode, stats, templates |

## Open Questions (to resolve during execution)

1. ~~**Backend URLs**: Resolved — Hermes 0.1.0 is offline-only. URLs are dead code, leave as-is.~~
2. **Cargo crate name**: Does renaming the Rust crate from `Readest` to `Hermes` break Tauri integration or CI? Needs verification before changing.
3. **qcms submodule**: Is it referenced anywhere? If not, remove from `.gitmodules`.
4. **appdata.xml URLs**: Should help/donation links stay pointed at upstream readest.io for attribution, or be updated?
5. **Sync settings visibility**: Should sync-related settings panels (KOReader, Readwise, Hardcover) be completely hidden, or visible with a note that they require a self-hosted backend?

## Verification

After all phases complete:
```bash
# Existing suites
pnpm test -- --watch=false
pnpm test:browser
pnpm lint
pnpm format:check
pnpm fmt:check
pnpm clippy:check

# Build verification
pnpm build

# Feature verification (targeted)
# - SRS: review scheduling updates dueAt/interval/easeFactor/reviewCount correctly
# - Vocabulary: saved terms export to Anki TSV/CSV; lookup history records unsaved lookups
# - Japanese popup: jaPlugin adds phonetic annotations without regressing zhPlugin
# - Reading stats: session time persists across reopen; streak/goals derive from recorded sessions
# - AI recap: summaries stay bounded to current progress and do not reference future chapters
# - Focus mode: header/footer/sidebar all hide and are recoverable via keyboard/pointer
# - Export templates: Obsidian/Notion presets render valid markdown via existing template engine
# - Branding: no translation.json file contains orphaned Readest keys
# - Workflow alignment: release config still matches supported targets
```
