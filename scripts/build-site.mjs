/**
 * morhirc Site Builder v0.85 JSON -> static GitHub Pages output.
 * 既存の Site Builder の buildExportFiles() を、そのまま Chromium で実行します。
 * 公開HTMLの生成ロジックを別実装しないため、表示の差異を防ぎます。
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

function validateProject(project) {
  if (!project || !Array.isArray(project.pages) || !project.pages.length ||
      !project.pages.every(page => page?.id && Array.isArray(page.elements))) {
    throw new Error('編集保存したSite BuilderのJSONではありません。');
  }
  const siteUrl = new URL(String(project.siteUrl ?? ''));
  if (siteUrl.href !== expectedWebsite) {
    throw new Error(`公開URLが想定と異なります: ${siteUrl.href}\n期待値: ${expectedWebsite}`);
  }
  const slugs = new Set();
  for (const page of project.pages) {
    const slug = String(page.slug ?? '').trim();
    if (!/^[a-z0-9-]+$/.test(slug)) {
      throw new Error(`不正なページslug: ${slug}`);
    }
    if (slugs.has(slug)) throw new Error(`ページslugが重複: ${slug}`);
    slugs.add(slug);
  }
  if (!slugs.has('index')) throw new Error('indexページが必要です。');
}

// Site Builder v0.85 のクロージャ内から生成関数を呼び出せるようにする。
// エディター本体のコードは変更せず、実行時のメモリ上でのみブリッジを注入。
function insertExportBridge(editorHTML) {
  const anchor = ' refreshPanelLayout();\n renderAll();\n})();';
  if (editorHTML.split(anchor).length !== 2) {
    throw new Error('Site Builderの生成処理が変更されています。ビルド用ブリッジの更新が必要です。');
  }
  const bridge = `
 window.__buildSiteFromProjectJSON = (json) => {
   if (!json || !Array.isArray(json.pages) || !json.pages.length ||
       !json.pages.every(p => p.id && Array.isArray(p.elements))) {
     throw new Error('Invalid Site Builder JSON');
   }
   project = json;
   if (!Array.isArray(project.userColors)) project.userColors = [];
   if (!project.header || typeof project.header !== 'object') project.header = defaultHeader();
   return buildExportFiles();
 };
`;
  return editorHTML.replace(anchor, bridge + anchor);
}

async function main() {
  const [jsonText, sourceHTML] = await Promise.all([
    fs.readFile(inputPath, 'utf8'),
    fs.readFile(editorPath, 'utf8'),
  ]);
  const project = JSON.parse(jsonText);
  validateProject(project);
  const editorHTML = insertExportBridge(sourceHTML);

  // 外部サーバーへのアクセスなし。about:blankのstorageに必要最小限のダミーを設ける。
  // project JSONはlocalStorageに入れず、引数として渡す（ブラウザの容量制限を回避）。
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.SITE_BUILDER_CHROMIUM_PATH
      ? {executablePath: process.env.SITE_BUILDER_CHROMIUM_PATH}
      : {}),
  });
  let files;
  try {
    const page = await browser.newPage();
    page.on('pageerror', error => {
      console.error('Site Builder page error:', error.message);
    });
    await page.evaluate(() => {
      Object.defineProperty(window, 'localStorage', {
        configurable: true,
        value: {
          getItem: () => null,
          setItem: () => {},
          removeItem: () => {},
        },
      });
    });
    await page.setContent(editorHTML, {waitUntil: 'domcontentloaded', timeout: 60000});
    if (await page.evaluate(() => typeof window.__buildSiteFromProjectJSON) !== 'function') {
      throw new Error('Site Builderの生成処理を読み込めませんでした。');
    }
    files = await page.evaluate(data => window.__buildSiteFromProjectJSON(data), project);
    await page.close();
  } finally {
    await browser.close();
  }
  if (!files || typeof files !== 'object' || !files['index.html']) {
    throw new Error('index.htmlが生成されませんでした。');
  }

  // 成功時だけ出力先を差し替える。無効なファイル名には書き込みません。
  const tempDir = path.join(root, 'dist-build-temp');
  await fs.rm(tempDir, {recursive: true, force: true});
  await fs.mkdir(tempDir, {recursive: true});
  try {
    let size = 0;
    for (const [filename, content] of Object.entries(files)) {
      if (!/^(?:[a-z0-9-]+\.html|sitemap\.xml|robots\.txt)$/.test(filename)) {
        throw new Error(`予期しない生成ファイル名: ${filename}`);
      }
      if (typeof content !== 'string') {
        throw new Error(`${filename}の内容が文字列ではありません。`);
      }
      const bytes = Buffer.byteLength(content, 'utf8');
      size += bytes;
      await fs.writeFile(path.join(tempDir, filename), content, 'utf8');
      console.log(`OK ${filename}: ${(bytes / 1024).toFixed(1)} KiB`);
    }
    if (!files['sitemap.xml'] || !files['robots.txt']) {
      throw new Error('sitemap.xmlまたはrobots.txtが欠けています。');
    }
    // Pages のカスタムワークフローでは GitHub の設定済みドメインを使う。
    // CNAME ファイルによるドメイン変更は行わない。
    await fs.writeFile(path.join(tempDir, '.nojekyll'), '');
    await fs.rm(outputDir, {recursive: true, force: true});
    await fs.rename(tempDir, outputDir);
    console.log(`完了: ${Object.keys(files).length} files / ${(size / 1024 / 1024).toFixed(2)} MiB`);
    console.log(`公開URL: ${expectedWebsite}`);
  } catch (error) {
    await fs.rm(tempDir, {recursive: true, force: true});
    throw error;
  }
}

main().catch(error => {
  console.error('生成失敗:', error.message);
  process.exitCode = 1;
});
