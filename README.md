# MOA工房 — Site Builder JSON 自動公開（試験導入版）

morhirc Site Builder **v0.85** の編集用 JSON を GitHub にアップロードすると、GitHub Actions が公開用の HTML・サイトマップ・robots.txt を生成して GitHub Pages に公開します。

**既存の Site Builder の `buildExportFiles()` を直接呼び出す構成です。** 別のHTML生成ロジックは作っていません。ブラウザ環境が必要なため、GitHub Actions 内の Chromium で実行します。

## 初回の設定（1回だけ）

**対象リポジトリ：`morhirc/moa-kobo-site`**

1. 念のため、現在のリポジトリをバックアップしてください（GitHub の `Code` → `Download ZIP`）。
2. GitHub の **Settings → Pages → Build and deployment → Source** を、現在の「Deploy from a branch」から **「GitHub Actions」** に変更します。
3. このZIPを展開し、次のファイルを**フォルダー構成を維持して**リポジトリの `main` ブランチに追加します。既存の公開HTMLやDNSは変更しません。
   - `site-project.json`（現在のMOA工房データ）
   - `site-builder.html`（HTMLを生成するSite Builder v0.85本体）
   - `package.json`
   - `scripts/build-site.mjs`
   - `.github/workflows/deploy.yml`
   - `.gitignore` と `README.md` は任意です。
4. コミットされると GitHub の **Actions** で「Site Builder JSON → GitHub Pages」が自動実行されます。`build` と `deploy` が成功するか確認してください。
5. `https://www.moa-kobo.com/` と `https://moa-kobo.com/` が正常に開くか確認してください。

**注意：** ソースをGitHub Actionsに切り替えるまで、自動デプロイは成功しません。独自ドメイン設定・DNS・Enforce HTTPSは現在のままで構いません。GitHub Actions方式では `CNAME` ファイルは不要です。

## 2回目以降の更新（JSONを1つ差し替えるだけ）

1. Site Builder で編集し、「編集保存」で JSON を書き出します。
2. GitHub の `morhirc/moa-kobo-site` で、ルートの **`site-project.json`** を新しいJSONに差し替えてコミットします（ファイル名は固定）。
3. GitHub Actions が8ファイル相当を再生成し、公開サイトを更新します。ページ数により生成ファイル数は変わります。

※ GitHubに `site-project (16).json` のような別名で追加するだけでは更新されません。**`site-project.json` の中身を上書き**してください。

## 仕組みと注意事項

- Site Builder本体のHTML生成処理を使うため、文字効果・リンク・画像・スマホレイアウト・SEO設定を維持します。
- JSONに埋め込まれた画像もそのまま公開HTMLに含まれます。今回は約 **23.33 MiB（公開HTML等の合計）** でした。
- JSONが壊れている、公開URLが `https://www.moa-kobo.com/` ではない、重複したページ名がある等の場合は、ビルドを失敗させ、古い公開サイトを維持します。
- Site Builderをv0.86以降へ更新して新機能を公開する際は、GitHubの `site-builder.html` も新しい本体へ差し替え、ビルドが成功することを確認してください。生成関数の末尾構造が変更された場合は `scripts/build-site.mjs` のブリッジの更新が必要です。
- GitHub Pagesの**公開方式だけ**「GitHub Actions」へ変更します。`www` のCNAMEやルートドメインのAレコードは変更しません。
- 公開HTMLは `dist/` に生成し、GitHub Pagesのデプロイ用アーティファクトとして送ります。リポジトリの既存 `index.html` などを上書きしません。
- **GitHub上の自動実行自体はまだ未検証**です。ローカルのChromiumで8ファイルの生成とバイト単位の一致を検証済みです。

## ローカル動作確認（任意）

Node.js 22以上、npmが必要です。

```bash
npm install
npx playwright install chromium
npm run build
```

`dist/` にサイトが生成されます。GitHub Actionsでは必要なLinux依存も含めて自動インストールされます。
