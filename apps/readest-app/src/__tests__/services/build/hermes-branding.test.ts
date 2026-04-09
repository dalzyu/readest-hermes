import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

const repoRoot = path.resolve(import.meta.dirname, '../../../../../..');

const readRepoFile = (relativePath: string) =>
  fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');

describe('Hermes branding copy', () => {
  test('app metadata and user-facing copy use Hermes branding', () => {
    const layout = readRepoFile('apps/readest-app/src/app/layout.tsx');
    const pagesApp = readRepoFile('apps/readest-app/src/pages/_app.tsx');
    const offlinePage = readRepoFile('apps/readest-app/src/app/offline/page.tsx');
    const settingsMenu = readRepoFile('apps/readest-app/src/app/library/components/SettingsMenu.tsx');
    const bookMenu = readRepoFile('apps/readest-app/src/app/reader/components/sidebar/BookMenu.tsx');
    const aboutWindow = readRepoFile('apps/readest-app/src/components/AboutWindow.tsx');
    const updaterWindow = readRepoFile('apps/readest-app/src/components/UpdaterWindow.tsx');
    const exportMarkdown = readRepoFile(
      'apps/readest-app/src/app/reader/components/annotator/ExportMarkdownDialog.tsx',
    );
    const aiTranslatePanel = readRepoFile('apps/readest-app/src/components/settings/AITranslatePanel.tsx');
    const koSyncSettings = readRepoFile('apps/readest-app/src/app/reader/components/KOSyncSettings.tsx');
    const commandRegistry = readRepoFile('apps/readest-app/src/services/commandRegistry.ts');
    const nav = readRepoFile('apps/readest-app/src/utils/nav.ts');

    expect(layout).toContain("const title = 'Hermes");
    expect(layout).toContain("content='Hermes'");
    expect(pagesApp).toContain("content='Hermes'");
    expect(pagesApp).toContain("content='Hermes is an open-source eBook reader");
    expect(offlinePage).toContain('>Hermes<');
    expect(settingsMenu).toContain("Upgrade to Hermes Premium");
    expect(settingsMenu).toContain("Download the original project");
    expect(settingsMenu).toContain("About Hermes");
    expect(settingsMenu).toContain("Help improve Hermes");
    expect(bookMenu).toContain("Download the original project");
    expect(bookMenu).toContain("About Hermes");
    expect(aboutWindow).toContain("title={_('About Hermes')}");
    expect(aboutWindow).toContain('>Hermes<');
    expect(updaterWindow).toContain("A new version of Hermes is available!");
    expect(updaterWindow).toContain("Hermes {{newVersion}} is available");
    expect(updaterWindow).toContain('"What\'s New in Hermes"');
    expect(exportMarkdown).toContain('Exported from Hermes');
    expect(aiTranslatePanel).toContain('DeepL requires a Hermes account. Please log in.');
    expect(koSyncSettings).toContain('Hermes (');
    expect(commandRegistry).toContain("About Hermes");
    expect(commandRegistry).toContain("Help improve Hermes");
    expect(nav).toContain("title: appService.isMacOSApp ? '' : 'Hermes'");
  });

  test('upstream links keep original-project attribution in visible text', () => {
    const settingsMenu = readRepoFile('apps/readest-app/src/app/library/components/SettingsMenu.tsx');
    const bookMenu = readRepoFile('apps/readest-app/src/app/reader/components/sidebar/BookMenu.tsx');
    const supportLinks = readRepoFile('apps/readest-app/src/components/SupportLinks.tsx');
    const opdsCatalog = readRepoFile('apps/readest-app/src/app/opds/components/CatelogManager.tsx');
    const errorPage = readRepoFile('apps/readest-app/src/app/error.tsx');
    const subscriptionSuccess = readRepoFile('apps/readest-app/src/app/user/subscription/success/page.tsx');

    expect(settingsMenu).toContain('Download the original project');
    expect(bookMenu).toContain('Download the original project');
    expect(supportLinks).toContain('Get help from the original project community');
    expect(errorPage).toContain('Contact the original project support team');
    expect(subscriptionSuccess).toContain(
      'Need help? Contact the original project support team at support@readest.com',
    );
    expect(opdsCatalog).toContain('proxied through the original project servers');
    expect(opdsCatalog).toContain('If I do not trust the original project with these credentials');
  });
});
