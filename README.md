# tetta-pdnt.github.io

Astroで管理するGitHub Pagesサイトです。YouTubeとSoundCloudのRSSをGitHub Actionsが定期取得し、`public/data/items.json` にまとめて公開します。

## RSSを追加する

`feeds.json` の `url` を自分のURLに置き換えます。

- YouTube: `https://www.youtube.com/feeds/videos.xml?channel_id=CHANNEL_ID` または `https://www.youtube.com/feeds/videos.xml?channel_id=@handle`
- SoundCloud: `https://feeds.soundcloud.com/users/soundcloud:users:USER_ID/sounds.rss`

`tags` にはサイト上で絞り込みたい分類を入れます。

```json
{
  "title": "YouTube",
  "url": "https://www.youtube.com/feeds/videos.xml?channel_id=CHANNEL_ID",
  "type": "video",
  "tags": ["映像", "音楽"]
}
```

## externalの文章を表示する

`external/*` にサブモジュールを置くと、ビルド時にMarkdown/TXT/phile系ファイルを読み取り、RSS項目と同じ一覧に表示します。RSSではない項目はクリックすると `/items/.../` の内部ページに遷移し、全文を表示します。

例:

```bash
git submodule add https://github.com/writings-tetta/snippets.git external/snippets
npm run submodules:init
```

登録済みの作品リポジトリを最新コミットへ進める場合は、次を実行します。

```bash
npm run submodules:update
git add external
git commit -m "Update writing submodules"
```

`npm run build` と `npm run dev` は、サブモジュールが未取得だったり、`.gitmodules` と
`external.config.json` の登録内容が食い違っていたりすると処理を中断します。単独で確認する場合は
`npm run submodules:check` を使えます。

記事ごとの見出し画像は、画像を `public/images/articles/` に置き、Markdownのfrontmatterで指定します。

```yaml
image: /images/articles/example.webp
imageAlt: 記事画像の説明
```

読み取り設定は `external.config.json` で変更できます。各sourceの `include` にリポジトリ内の相対パスを指定すると、そのファイルだけを読み込みます。frontmatterがあれば `title`, `date`, `publishedAt`, `summary`, `image`, `url`, `tags`, `source`, `type` を使います。なければ見出し、ファイル名、本文から補います。

private repositoryの場合は、すべての作品リポジトリを読み取れるfine-grained PATを
GitHub ActionsのRepository secret `SUBMODULES_TOKEN` に設定してください。公開リポジトリだけを
使う場合、このsecretは不要です。PATには対象リポジトリの `Contents: Read-only` だけを付与します。

## RSSに出ない項目を足す

SoundCloudのRSSは公開曲を全件返さないことがあります。RSSに出ない曲は `manual-items.json` に追加すると、RSS取得分と同じ一覧に混ざります。

```json
{
  "items": [
    {
      "title": "Track title",
      "url": "https://soundcloud.com/pedantophile/track",
      "publishedAt": "2026-01-01T00:00:00+09:00",
      "summary": "任意の説明",
      "image": "https://i1.sndcdn.com/artworks-...-t3000x3000.jpg",
      "source": "SoundCloud",
      "type": "music",
      "tags": ["音楽"]
    }
  ]
}
```

## ローカル確認

```bash
npm run build
npm run preview
```

`npm run dev` でも開発サーバーを起動できます。

## GitHub Pages

1. GitHubで `tetta-pdnt.github.io` リポジトリを作成します。
2. このディレクトリを `main` ブランチでpushします。
3. Repository settingsの Pages で Source を `GitHub Actions` にします。

以後、push時と6時間ごとのスケジュールでRSSが更新されます。
