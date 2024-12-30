# VOICEVOX Preview Pages

[voicevox/voicevox](https://github.com/voicevox/voicevox) のプレビューページを提供するためのリポジトリです。  
対象ブランチ：

- `main`
- `project-*`
- プルリクエスト

## 動かす

### Webサーバーだけ動かす場合

以下のコマンドを実行します：
```
pnpm i
curl https://voicevox.github.io/preview-pages/preview/downloads.json -o ./public/preview/downloads.json
pnpm run dev
```

### コメントの追加などの書き込み系の動作なしで動かす場合

1. GitHub の Personal Access Token を取得します。
2. `.env.example` をコピーして `.env` を作成します。内容はコメントを参照してください。
3. 以下のコマンドを実行します：

```
pnpm run run:collect-artifacts
```

### 書き込み系の動作を含めて動かす場合

1. GitHub Appsを作成します。

権限は以下の通りです：

- Pull requests：Read & write

#### Actionsで動かす

2. 作成したGitHub Appsの`Private key`を取得し、リポジトリの`Settings` > `Secrets` に`PRIVATE_KEY`として保存します。
3. `.env.example` の内容をリポジトリの`Settings` > `Secrets` にキーごとに保存します。

#### ローカルで動かす

2. 作成したGitHub Appsの`Private key`を取得し、`private-key.pem`として保存します。
3. `.env.example` をコピーして `.env` を作成します。内容はコメントを参照してください。
4. 以下のコマンドを実行します：

```
pnpm run run:collect-artifacts
pnpm run run:update-comments
```

## 仕組み

```mermaid
sequenceDiagram
    actor user as ユーザー
    participant editor_fork as ユーザー/voicevox（フォーク）
    participant editor_main as voicevox/voicevox（main）
    participant preview_pages as voicevox/preview_pages

    user->>editor_fork: PRを出す
    
    note over editor_fork: ビルドを開始する
    activate editor_fork

    user-->>editor_main: pull_request_targetが発火する
    editor_main->>+preview_pages: update_pages.ymlを発火させる

    loop 
        preview_pages->>editor_fork: Jobの終了を問い合わせる
        editor_fork->>preview_pages: 
    end

    note over editor_fork: ビルドが完了する
    deactivate editor_fork
    preview_pages->>editor_fork: Artifactをダウンロードする
    editor_fork->>preview_pages: 

    note over preview_pages: Pagesにデプロイする
    deactivate preview_pages
```

## ライセンス

[LICENSE](LICENSE) を参照してください。

