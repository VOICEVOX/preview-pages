# VOICEVOX Preview Pages

[voicevox/voicevox](https://github.com/voicevox/voicevox) のプレビューを提供するためのリポジトリです。

## 動かす

1. GitHub Appsを作成します。

権限は以下の通りです：

- Pull requests：Read & write

2. 作成したGitHub Appsの`Private key`を取得し、`private-key.pem`として保存します。
3. `.env.example` をコピーして `.env` を作成します。内容はコメントを参照してください。
4. 以下のSecretsを設定します：

- `ENV`：`.env`の内容
- `PRIVATE_KEY`：`private-key.pem`の内容

## ライセンス

[LICENSE](LICENSE) を参照してください。
