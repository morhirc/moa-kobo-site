/**
 * MOA工房 / morhirc Site Builder JSON -> GitHub Pages
 * Site Builder本体の buildExportFiles() を呼び出すことで生成ロジックを一本化します。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const inputPath = path.join(root, 'site-project.json');
const editorPath = path.join(root, 'site-builder.html');
const outputDir = path.join(root, 'dist');
const expectedWebsite = 'https://www.moa-kobo.com/';

// 旧URLから現在のページへの即時HTML転送。GitHub PagesではHTTP 301ではなく
// meta refresh(0秒)として公開。Googleは恒久的な転送シグナルとして扱います。
// フォルダー/index.html 形式にすることで /qa → /qa/ → 新URL と移動できます。
const legacyRedirects = Object.freeze({
  'qa': 'q-a.html',
  '詳しい料金表': 'pricing.html',
  'お問い合わせ・ご相談': 'contact.html',
  '訪問サポートについて': 'onsite-support.html',
  'ホーム': 'index.html',
});
const legacyRedirectFiles = new Map(
  Object.entries(legacyRedirects).map(([oldPath, target]) => [`${oldPath}/index.html`, target])
);
function htmlEscape(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function makeLegacyRedirect(target) {
  const newUrl = new URL(target === 'index.html' ? '' : target, expectedWebsite).href;
  const u = htmlEscape(newUrl);
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8">
<meta http-equiv="refresh" content="0; url=${u}">
<link rel="canonical" href="${u}"><title>ページを移動しました</title>
</head><body><p>ページを移動しました。<a href="${u}">こちらから移動してください。</a></p></body></html>`;
}

function validateProject(project) {
  if (!project || !Array.isArray(project.pages) || !project.pages.length ||
      !project.pages.every(p => p && typeof p.id === 'string' && Array.isArray(p.elements))) {
    throw new Error('編集保存したSite BuilderのJSONではありません。');
  }
  let siteUrl;
  try { siteUrl = new URL(String(project.siteUrl || '')).href; }
  catch { throw new Error('サイトの公開URLが未設定です。'); }
  if (siteUrl !== expectedWebsite) {
    throw new Error(`公開URLが想定と異なります: ${siteUrl}\n期待値: ${expectedWebsite}`);
  }
  const slugs = new Set();
  for (const p of project.pages) {
    const slug = String(p.slug || '').trim();
    if (!/^[a-z0-9-]+$/.test(slug)) throw new Error(`不正なファイル名: ${slug}`);
    if (slugs.has(slug)) throw new Error(`ファイル名重複: ${slug}`);
    slugs.add(slug);
  }
  if (!slugs.has('index')) throw new Error('indexページが必要です。');
}
function insertExportBridge(editorHTML) {
  // 表示用バージョンでは判定せず、公開生成に必要な関数だけを確認します。
  if (!editorHTML.includes('function buildExportFiles()') ||
      !editorHTML.includes('function normalizeIndependentLayouts(')) {
    throw new Error('SiteBuilderの公開生成に必要な機能が見つかりません。');
  }
  const anchor = ' refreshPanelLayout();\n renderAll();\n})();';
  if (editorHTML.split(anchor).length !== 2) {
    throw new Error('SiteBuilderの末尾構造が変更されています。生成ブリッジを確認してください。');
  }
  const bridge = `
 // GitHub Actions専用: エディター画面を表示せず、同じ関数で公開HTMLを出力します。
 window.__buildSiteFromProjectJSON = (json) => {
   if (!json || !Array.isArray(json.pages) || !json.pages.length) throw Error('Invalid Site Builder JSON');
   project = json;
   if (!Array.isArray(project.userColors)) project.userColors = [];
   if (!project.header || typeof project.header !== 'object') project.header = defaultHeader();
   normalizeIndependentLayouts(project);
   return buildExportFiles();
 };
 `;
  return editorHTML.replace(anchor, bridge + anchor);
}
async function main() {
  const [jsonText, sourceHTML] = await Promise.all([
    fs.readFile(inputPath, 'utf8'), fs.readFile(editorPath, 'utf8'),
  ]);
  const project = JSON.parse(jsonText);
  validateProject(project);
  const editorHTML = insertExportBridge(sourceHTML);
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.SITE_BUILDER_CHROMIUM_PATH
      ? { executablePath: process.env.SITE_BUILDER_CHROMIUM_PATH }
      : {}),
  });
  let files;
  try {
    const page = await browser.newPage();
    page.on('pageerror', error => console.error('Site Builder page error:', error.message));
    await page.evaluate(() => {
      Object.defineProperty(window, 'localStorage', {
        configurable: true,
        value: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
      });
    });
    await page.setContent(editorHTML, { waitUntil: 'domcontentloaded', timeout: 120000 });
    if (await page.evaluate(() => typeof window.__buildSiteFromProjectJSON) !== 'function') {
      throw new Error('Site Builderの生成ブリッジを読み込めませんでした。');
    }
    files = await page.evaluate(json => window.__buildSiteFromProjectJSON(json), project);
    await page.close();
  } finally {
    await browser.close();
  }
  if (!files || typeof files !== 'object' || !files['index.html']) {
    throw new Error('index.htmlが生成されませんでした。');
  }
  // サイト本体を生成した後で旧URLの転送ページを追加。site-project.jsonの設定は変更しません。
  for (const [oldFile, target] of legacyRedirectFiles) {
    if (!Object.prototype.hasOwnProperty.call(files, target))
      throw new Error(`旧URLの転送先が生成されませんでした: ${target}`);
    if (Object.prototype.hasOwnProperty.call(files, oldFile))
      throw new Error(`旧URLが既存の公開ファイルと衝突しています: ${oldFile}`);
    files[oldFile] = makeLegacyRedirect(target);
  }
  const tempDir = path.join(root, 'dist-build-temp');
  await fs.rm(tempDir, { recursive: true, force: true });
  await fs.mkdir(tempDir, { recursive: true });
  try {
    let size = 0;
    for (const [filename, content] of Object.entries(files)) {
      // 移行用付属ファイルを許可（公開されても機密情報は含めないこと）。
      if (!/^(?:[a-z0-9-]+\.html|sitemap\.xml|robots\.txt|migration-urls\.csv|redirects-apache\.htaccess\.txt|MIGRATION-README\.txt)$/.test(filename) && !legacyRedirectFiles.has(filename)) {
        throw new Error(`予期しない生成ファイル名: ${filename}`);
      }
      if (typeof content !== 'string') throw new Error(`${filename}の内容が文字列ではありません。`);
      const bytes = Buffer.byteLength(content, 'utf8');
      size += bytes;
      await fs.mkdir(path.dirname(path.join(tempDir, filename)), { recursive: true });
      await fs.writeFile(path.join(tempDir, filename), content, 'utf8');
      console.log(`OK ${filename}: ${(bytes / 1024).toFixed(1)} KiB`);
    }
    if (!files['sitemap.xml'] || !files['robots.txt']) {
      throw new Error('sitemap.xmlまたはrobots.txtが生成されませんでした。');
    }
    await fs.writeFile(path.join(tempDir, '.nojekyll'), '');
    await fs.rm(outputDir, { recursive: true, force: true });
    await fs.rename(tempDir, outputDir);
    console.log(`公開HTML生成完了: ${Object.keys(files).length} files / ${(size / 1024 / 1024).toFixed(2)} MiB`);
  } catch (error) {
    await fs.rm(tempDir, { recursive: true, force: true });
    throw error;
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
