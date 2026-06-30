# LXFetch

[简体中文](README.zh-CN.md) | English

LXFetch is a self-hosted web music downloader for LX Music Desktop-compatible custom sources. It provides a local web UI for importing sources, searching music, browsing playlists/leaderboards, downloading high-quality audio, writing cover/lyric metadata, and running playlist or leaderboard subscriptions.

LXFetch does not include resolver sources. Import at least one LX Music Desktop-compatible custom source before downloading.

## Features

- LX Music Desktop-compatible custom source import, validation, enable/disable, delete, and ordering.
- Song search, playlist browsing, user playlist browsing, and leaderboard browsing.
- Download songs from search results, playlists, and leaderboards.
- Playlist and leaderboard subscriptions that queue new songs while LXFetch is running.
- Best-quality-first resolving with automatic fallback and URL quality probing.
- Cover, lyric, title, artist, and album tag writing with post-download verification.

## Docker Deployment

Create a directory and download only the deployment files:

```bash
mkdir lxfetch
cd lxfetch
curl -LO https://raw.githubusercontent.com/yzfh-ty/LXFetch/main/docker-compose.yml
curl -Lo .env.example https://raw.githubusercontent.com/yzfh-ty/LXFetch/main/.env.example
cp .env.example .env
sed -i "s/^PUID=.*/PUID=$(id -u)/" .env
sed -i "s/^PGID=.*/PGID=$(id -g)/" .env
mkdir -p data downloads
```

Start LXFetch:

```bash
docker compose pull
docker compose up -d
```

Open:

```text
http://127.0.0.1:9528
```

Runtime state is stored in `./data`. Downloaded audio files are stored in `./downloads`.
The container fixes mounted directory ownership on startup and then runs the app as `PUID:PGID` from `.env`.

To update:

```bash
docker compose pull
docker compose up -d
```

To stop:

```bash
docker compose down
```

## Configuration

Docker deployments should use `.env`. Environment variables override `config.js`.

Important variables:

| Variable | Default | Description |
| --- | --- | --- |
| `LXFETCH_IMAGE` | `ghcr.io/yzfh-ty/lxfetch:latest` | Docker image used by `docker-compose.yml`. Set a version tag such as `ghcr.io/yzfh-ty/lxfetch:0.1.2` to pin a release. |
| `PUID` | `1000` | Host user ID used by the container to write mounted directories. Set it with `id -u`. |
| `PGID` | `1000` | Host group ID used by the container to write mounted directories. Set it with `id -g`. |
| `LXFETCH_PORT` | `9528` | Web UI port. |
| `LXFETCH_ADMIN_PASSWORD` | empty | Optional admin password. Empty disables password checks. |
| `LXFETCH_DOWNLOAD_DIR` | `/app/downloads` | Download directory inside the container. `docker-compose.yml` maps it to host `./downloads`. |
| `LXFETCH_MAX_CONCURRENT` | `1` | Maximum active download tasks. |
| `LXFETCH_THROTTLE_BYTES_PER_SECOND` | `0` | Per-task speed limit in bytes/s. `0` means unlimited. |
| `LXFETCH_FILENAME_PATTERN` | `{name} - {singer}` | Filename pattern. Supports `{name}`, `{singer}`, `{album}`, `{source}`, `{quality}`, and `{id}`. |
| `LXFETCH_EMBED_COVER` | `true` | Embed cover art. |
| `LXFETCH_EMBED_LYRIC` | `true` | Embed lyrics. |
| `LXFETCH_WRITE_TAGS` | `true` | Write audio tags. |
| `LXFETCH_VERIFY_METADATA` | `true` | Verify downloaded files and tags. |
| `NETEASE_COOKIE` | empty | Optional NetEase Cloud Music cookie for `wy` resolving. |
| `LXFETCH_SUBSCRIPTION_MAX_TASKS_PER_RUN` | `0` | Maximum new tasks per subscription update. `0` queues all discovered songs. |
| `LXFETCH_SUBSCRIPTION_TASK_CREATE_DELAY_MS` | `1500` | Delay between subscription-created tasks in milliseconds. |
| `LXFETCH_NAVIDROME_ENABLED` | `false` | Enable Navidrome integration. |
| `LXFETCH_NAVIDROME_PLAYLIST_SYNC_ENABLED` | `false` | Export subscriptions as Navidrome-scannable public `.nsp` smart playlists. |
| `LXFETCH_NAVIDROME_PLAYLIST_DIR` | `/app/downloads/_playlists` | `.nsp` smart playlist output directory. Navidrome must be able to read this directory. |
| `LXFETCH_NAVIDROME_PLAYLIST_PATH_MODE` | `relative` | Write `filepath` rules relative to the Navidrome music folder. Use `absolute` only when both containers share the same absolute paths. |
| `LXFETCH_NAVIDROME_PLAYLIST_EXPORT_INTERVAL_MINUTES` | `5` | Periodic refresh interval for generated smart playlists. |
| `LXFETCH_NAVIDROME_SCAN_AFTER_EXPORT` | `false` | Call the Navidrome/Subsonic scan endpoint after playlist changes. |
| `LXFETCH_NAVIDROME_BASE_URL` | empty | Navidrome URL, for example `http://navidrome:4533`. Required for automatic scan. |
| `LXFETCH_NAVIDROME_USERNAME` | empty | Navidrome username. Required for automatic scan. |
| `LXFETCH_NAVIDROME_PASSWORD` | empty | Navidrome password. Required for automatic scan. |
| `LXFETCH_LOCAL_MATCH_ENABLED` | `false` | Scan existing audio files under the download directory and match them to subscriptions before writing `.nsp` playlists. |
| `LXFETCH_LOCAL_MATCH_WATCH_ENABLED` | `true` | Watch the download directory and rerun matching after audio files are added, changed, or removed. |
| `LXFETCH_LOCAL_MATCH_MODE` | `duration` | Local match mode: `strict` uses platform IDs only, `metadata` uses title/artist/album, and `duration` also allows a duration tolerance. |
| `LXFETCH_LOCAL_MATCH_INCLUDE_UNMATCHED_PLAYLIST` | `true` | Export an unmatched smart playlist for local files not assigned to any subscription. |

See `.env.example` for the full list.

## Navidrome Playlist Sync

When `LXFETCH_NAVIDROME_ENABLED=true` and `LXFETCH_NAVIDROME_PLAYLIST_SYNC_ENABLED=true`, LXFetch exports subscribed playlists and leaderboards as Navidrome `.nsp` smart playlists with `"public": true`, so they are visible to all Navidrome users. If there is no name conflict, the Navidrome playlist uses the original title. If multiple subscriptions share the same title, LXFetch appends a platform or short ID suffix to distinguish them.

Navidrome imports generated `.nsp` files during a library scan. Smart playlist track counts may refresh when the playlist is opened in Navidrome.

`LXFETCH_NAVIDROME_ENABLED` only enables the Navidrome integration code in LXFetch. It does not start a Navidrome server; Navidrome must run separately.

For existing local music libraries, enable `LXFETCH_LOCAL_MATCH_ENABLED=true`. LXFetch will scan audio files under `downloads`, read tags or fall back to filenames like `Title - Artist.flac`, then match files to subscribed playlists by priority. Once a file is matched by an earlier subscription, it is removed from the remaining pool. Disabled subscriptions still participate in local matching and smart playlist generation; they are only excluded from scheduled automatic downloads. Files that do not match any subscription can be exported to an unmatched playlist. Artist matching accepts common multi-artist separators such as `、`, `,`, `/`, `&`, and `feat.`.

When a subscription updates, LXFetch scans the playlist or leaderboard first and then creates download tasks one by one. After scanning finishes and task creation begins, the remaining task creation can be cancelled from the subscriptions page. Already-created download tasks are not stopped automatically and can be stopped separately from the tasks page.

Navidrome should mount the same downloads directory and read playlists from `_playlists`:

```yaml
navidrome:
  image: deluan/navidrome:latest
  volumes:
    - ./downloads:/music:ro
    - ./navidrome-data:/data
  environment:
    ND_MUSICFOLDER: /music
    ND_PLAYLISTSPATH: _playlists
```

## Local Development

```bash
npm install
npm run dev
```

Build and run locally:

```bash
npm run build
npm start
```

## Docker Images

Docker images are published to GitHub Container Registry only when a `v*` tag is pushed.

```text
ghcr.io/yzfh-ty/lxfetch:latest
ghcr.io/yzfh-ty/lxfetch:0.1.2
ghcr.io/yzfh-ty/lxfetch:0.1
```

## References

LXFetch is independent. Its primary compatibility target is the LX Music Desktop custom source protocol.

- [LX Music Desktop](https://github.com/lyswhut/lx-music-desktop): original custom source protocol, platform music data formats, quality order, and desktop download behavior.
- [lxserver](https://github.com/XCQ0607/lxserver): a server-side project compatible with LX Music Desktop custom sources; used as a backend reference for source loading, resolver flow, music SDK usage, metadata handling, and quality fallback.
- [lx-music-source](https://github.com/pdone/lx-music-source): public custom source examples used for compatibility testing.
- [Netease_url](https://github.com/Suxiaoqinx/Netease_url): reference for optional NetEase cookie-based `wy` resolving.

Respect the licenses and usage rules of the referenced projects and any custom sources you import.
