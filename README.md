# LXFetch

[简体中文](README.zh-CN.md) | English

LXFetch is a self-hosted web music downloader built around LX Music Desktop-compatible custom sources. It focuses on high-quality local downloads, playlist and leaderboard browsing, subscription updates, cover and lyric collection, audio tag writing, and post-download metadata verification.

LXFetch does not ship with built-in resolver sources. Import an LX Music Desktop-compatible custom source before downloading.

## Features

- Import, validate, enable, disable, reorder, and delete LX custom source scripts.
- Search songs across supported music platforms.
- Browse playlists, user playlists, and leaderboards exposed by the LX music SDK.
- Download single songs or the current page of playlist/leaderboard results.
- Subscribe to playlists or leaderboards and periodically queue newly discovered songs.
- Prefer higher-quality audio when multiple custom sources return usable links.
- Always start from `Highest Available` quality and automatically downgrade only when needed.
- Write title, artist, album, cover, and lyrics into downloaded audio files.
- Verify downloaded files and metadata after each task.
- Manage download tasks, subscriptions, custom sources, completed files, and effective runtime configuration from a local web UI.

## Requirements

- Node.js 18 or newer.
- At least one LX Music Desktop-compatible custom source script.

## Install

```bash
npm install
```

## Development

```bash
npm run dev
```

Open:

```text
http://127.0.0.1:9528
```

## Production Run

```bash
npm run build
npm start
```

LXFetch only runs while this process is running. It does not install or keep a background service.

## Docker

Build and run:

```bash
docker build -t lxfetch .
mkdir -p data
docker run --rm -p 9528:9528 -v "$PWD/data:/app/data" lxfetch
```

Open:

```text
http://127.0.0.1:9528
```

Use Docker Compose:

```bash
cp .env.example .env
docker compose up --build
```

Docker stores runtime data in the mounted `./data` directory, including custom sources, subscriptions, tasks, metadata cache, and downloaded files. Stop the container to stop LXFetch.

Use the GitHub Container Registry image after it is published:

```bash
mkdir -p data
docker pull ghcr.io/yzfh-ty/lxfetch:latest
docker run --rm -p 9528:9528 -v "$PWD/data:/app/data" ghcr.io/yzfh-ty/lxfetch:latest
```

Docker images are published by `.github/workflows/docker.yml` when `main` is pushed, when a `v*` tag is pushed, or when the workflow is run manually from GitHub Actions. The image tags include `latest` for `main`, semantic version tags for Git tags such as `v0.1.0`, and a `sha-*` tag for each build.

Docker Compose reads `.env` from the project directory. Copy `.env.example` to `.env` and edit that file instead of changing `docker-compose.yml`.

To use a custom config:

```bash
cp config.example.js config.js
docker run --rm -p 9528:9528 \
  -v "$PWD/data:/app/data" \
  -v "$PWD/config.js:/app/config.js:ro" \
  lxfetch
```

For the published image, replace `lxfetch` with `ghcr.io/yzfh-ty/lxfetch:latest`.

If the mounted `data` directory is not writable on your host, run the container as your current user:

```bash
docker run --rm -p 9528:9528 \
  --user "$(id -u):$(id -g)" \
  -v "$PWD/data:/app/data" \
  lxfetch
```

## Configuration

Copy the example config when customization is needed:

```bash
cp config.example.js config.js
```

Main options:

```js
module.exports = {
  server: {
    host: '0.0.0.0',
    port: 9528,
  },
  auth: {
    adminPassword: '',
  },
  source: {
    allowUnsafeVM: false,
  },
  netease: {
    cookie: '',
    cookieFile: '../Netease_url/cookie.txt',
  },
  download: {
    dir: './data/downloads',
    maxConcurrent: 1,
    throttleBytesPerSecond: 0,
    maxRetries: 2,
    retryDelayMs: 2000,
    filenamePattern: '{name} - {singer}',
    embedCover: true,
    embedLyric: true,
    writeTags: true,
    verifyMetadata: true,
    cacheMetadata: true,
    metadataCacheMaxAgeDays: 90,
    metadataCacheMaxBytes: 200 * 1024 * 1024,
    skipExisting: true,
    upgradeExisting: true,
  },
  subscription: {
    maxTasksPerRun: 0,
    taskCreateDelayMs: 1500,
  },
}
```

Notes:

- Environment variables override `config.js`. This is the recommended way to configure Docker deployments.
- Docker Compose reads `.env` automatically. Start from `.env.example`.
- `maxConcurrent` controls active download tasks. The default is `1`.
- `netease.cookie` sets an optional full NetEase Cloud Music cookie. When set, NetEase (`wy`) downloads try cookie-based resolving first and fall back to custom sources if it fails. You can also set `NETEASE_COOKIE`, `NETEASE_COOKIES`, or `WY_COOKIE`.
- `netease.cookieFile` is used when `netease.cookie` is empty. The default is `../Netease_url/cookie.txt`.
- `throttleBytesPerSecond` is a per-task speed limit in bytes per second. `0` means unlimited.
- `maxRetries` and `retryDelayMs` retry interrupted, timed-out, or temporary remote download failures. Resolver failures are not retried.
- `cacheMetadata` stores fetched lyrics and covers under `data/cache/metadata`.
- `metadataCacheMaxAgeDays` and `metadataCacheMaxBytes` control metadata cache cleanup.
- `skipExisting` skips creating a new download when the same song already exists locally.
- `upgradeExisting` allows a new download when the existing local copy is lower quality than the current song data explicitly reports. Existing files are kept.
- `maxTasksPerRun` limits how many new tasks a subscription can queue per update. `0` means queue all newly discovered songs in that update.
- `taskCreateDelayMs` delays task creation during subscription updates.
- `filenamePattern` supports `{name}`, `{singer}`, `{album}`, `{source}`, `{quality}`, and `{id}`.
- The web UI `Configuration` page is read-only. Edit `config.js` and restart LXFetch to change server-side options.

Environment variables:

| Variable | Default | Description |
| --- | --- | --- |
| `NODE_ENV` | `production` | Node.js runtime mode. |
| `LXFETCH_HOST` | `0.0.0.0` | HTTP server bind address. Keep `0.0.0.0` in Docker. |
| `LXFETCH_PORT` | `9528` | HTTP server port. Docker Compose uses the same value for host and container port. |
| `LXFETCH_ADMIN_PASSWORD` | empty | Optional admin password for source management and other write actions. Empty disables password checks. |
| `LXFETCH_ALLOW_UNSAFE_VM` | `false` | Enables unsafe custom source compatibility mode. Keep disabled unless an old source requires it. |
| `NETEASE_COOKIE` | empty | Optional full NetEase Cloud Music cookie. Used before custom sources for `wy` downloads. |
| `NETEASE_COOKIES` | empty | Alternate NetEase cookie environment variable. |
| `WY_COOKIE` | empty | Alternate NetEase cookie environment variable. |
| `NETEASE_COOKIE_FILE` | empty | Path to a NetEase cookie file. Overrides the default config value when set. |
| `WY_COOKIE_FILE` | empty | Alternate NetEase cookie file path variable. |
| `LXFETCH_DOWNLOAD_DIR` | `./data/downloads` | Directory for downloaded audio files. Keep it under `/app/data` or mounted storage in Docker. |
| `LXFETCH_MAX_CONCURRENT` | `1` | Maximum number of active download tasks. |
| `LXFETCH_THROTTLE_BYTES_PER_SECOND` | `0` | Per-task bandwidth limit in bytes per second. `0` means unlimited. |
| `LXFETCH_MAX_RETRIES` | `2` | Retry count for interrupted, timed-out, temporary, or incomplete download failures. |
| `LXFETCH_RETRY_DELAY_MS` | `2000` | Delay between download retries in milliseconds. |
| `LXFETCH_FILENAME_PATTERN` | `{name} - {singer}` | Download filename pattern. Supports `{name}`, `{singer}`, `{album}`, `{source}`, `{quality}`, and `{id}`. |
| `LXFETCH_EMBED_COVER` | `true` | Embed cover art into downloaded audio files. |
| `LXFETCH_EMBED_LYRIC` | `true` | Embed lyrics into downloaded audio files. |
| `LXFETCH_WRITE_TAGS` | `true` | Write title, artist, album, cover, and lyric tags. |
| `LXFETCH_VERIFY_METADATA` | `true` | Verify downloaded files and metadata after tagging. |
| `LXFETCH_CACHE_METADATA` | `true` | Cache fetched covers and lyrics under `data/cache/metadata`. |
| `LXFETCH_METADATA_CACHE_MAX_AGE_DAYS` | `90` | Maximum metadata cache age in days. |
| `LXFETCH_METADATA_CACHE_MAX_BYTES` | `209715200` | Maximum metadata cache size in bytes. |
| `LXFETCH_SKIP_EXISTING` | `true` | Skip creating a new task when the same song already exists locally. |
| `LXFETCH_UPGRADE_EXISTING` | `true` | Allow downloading a better-quality copy when the existing local file is lower quality. |
| `LXFETCH_SUBSCRIPTION_MAX_TASKS_PER_RUN` | `0` | Maximum new tasks per subscription update. `0` queues all newly discovered songs. |
| `LXFETCH_SUBSCRIPTION_TASK_CREATE_DELAY_MS` | `1500` | Delay between creating subscription download tasks in milliseconds. |

## Quality Strategy

Downloads always start from `Highest Available`. The frontend does not send a fixed quality.

LXFetch follows the LX Music Desktop custom source quality order, which lxserver also follows:

```text
flac24bit -> flac -> wav -> ape -> 320k -> 192k -> 128k
```

LXFetch starts from the highest quality reported by the song data and tries lower qualities only when needed. Custom source quality declarations are treated as hints, not hard limits, because some LX-compatible sources under-declare their supported qualities while still returning valid FLAC links.

Resolved URLs are probed before download. If a custom source returns an MP3-sized link for a requested lossless quality, LXFetch rejects that quality and continues to the next usable quality instead of marking the file as lossless.

Downloaded files are checked again after writing metadata. The completed-files list stores the requested quality and the detected container/bitrate/sample-rate information so you can see what was actually saved.

Downloads also verify that the received byte count and final temporary file size match the response `Content-Length` when it is available. Incomplete files are rejected and retried according to `maxRetries`.

Playlist and leaderboard downloads are source-pinned. A Kuwo playlist downloads Kuwo songInfo, a NetEase playlist downloads NetEase songInfo, and LXFetch does not search or request other music platforms for those entries. If multiple enabled custom source scripts can resolve that same platform and quality, LXFetch probes the returned URLs and picks the best detected result.

For NetEase (`wy`) only, a configured `netease.cookie` is tried before custom sources. The returned URL is still probed, so MP3 links returned for lossless requests are rejected and normal fallback continues.

## Subscriptions

Open a playlist or leaderboard detail page, then use:

- `Subscribe Playlist`
- `Subscribe Leaderboard`

Subscriptions are stored in `data/subscriptions.json`. When LXFetch is running, the scheduler checks enabled subscriptions at their configured interval and queues newly discovered songs.

Existing downloaded songs and previously queued subscription songs are skipped to avoid repeat downloads. Download execution still uses the normal task queue, metadata writing, and verification flow.

When `upgradeExisting` is enabled, a subscription can still queue a song that already exists locally if the saved copy is lower quality than the current song data's reported best quality.

If `maxTasksPerRun` is set, large playlists or leaderboards are queued in batches. For example, a 200-song leaderboard with `maxTasksPerRun: 50` queues up to 50 new tasks per update; the next scheduled update, or a manual `Run Now`, can queue the next batch. Use `0` when you want one update to queue every newly discovered song.

The task page shows queue statistics and supports batch retry for failed tasks, stopping abortable active tasks, and clearing finished or failed/stopped task history.

Subscription records can be reset from the web UI. Use this when you want a playlist or leaderboard subscription to rescan songs that were previously queued but failed before producing a downloaded file.

## Runtime Data

Runtime data is stored under `data/`:

```text
data/
  sources/
    sources.json
    order.json
    scripts/
  downloads/
    downloads_index.json
  cache/
    metadata/
  subscriptions.json
  tasks.json
```

`data/` is local runtime state and should not be committed.

## References

LXFetch is an independent project. Its primary compatibility target is the LX Music Desktop custom source protocol, and parts of its backend behavior were implemented with reference to related compatible projects:

- [LX Music Desktop](https://github.com/lyswhut/lx-music-desktop): the original compatibility target for the custom source protocol, platform music data formats, quality order, and desktop download behavior.
- [lxserver](https://github.com/XCQ0607/lxserver): a server-side project that is also compatible with LX Music Desktop custom sources; its custom source loading, LX-compatible user API behavior, music SDK integration patterns, playlist/leaderboard access, resolver flow, metadata handling, and quality fallback behavior were used as backend references.
- [lx-music-source](https://github.com/pdone/lx-music-source): public LX Music Desktop custom source examples used for import and resolver compatibility testing.
- [Netease_url](https://github.com/Suxiaoqinx/Netease_url): NetEase Cloud Music cookie-based URL resolving was used as a reference for the optional `wy` cookie resolver path.

LXFetch is not affiliated with these projects. Respect the licenses and usage rules of the referenced projects and any custom sources you import.

## Useful Scripts

```bash
npm run build
npm start
node --check public/app.js
```
