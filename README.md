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

Runtime data is stored in `./data`, including custom sources, tasks, subscriptions, metadata cache, and downloaded files.
The container runs as `PUID:PGID` from `.env` so it can write to the mounted `./data` directory.

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
| `LXFETCH_IMAGE` | `ghcr.io/yzfh-ty/lxfetch:latest` | Docker image used by `docker-compose.yml`. Set a version tag such as `ghcr.io/yzfh-ty/lxfetch:0.1.0` to pin a release. |
| `PUID` | `1000` | Host user ID used by the container to write `./data`. Set it with `id -u`. |
| `PGID` | `1000` | Host group ID used by the container to write `./data`. Set it with `id -g`. |
| `LXFETCH_PORT` | `9528` | Web UI port. |
| `LXFETCH_ADMIN_PASSWORD` | empty | Optional admin password. Empty disables password checks. |
| `LXFETCH_DOWNLOAD_DIR` | `./data/downloads` | Download directory inside the container. Keep it under `/app/data` or `./data` persistence. |
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

See `.env.example` for the full list.

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
ghcr.io/yzfh-ty/lxfetch:0.1.0
ghcr.io/yzfh-ty/lxfetch:0.1
```

## References

LXFetch is independent. Its primary compatibility target is the LX Music Desktop custom source protocol.

- [LX Music Desktop](https://github.com/lyswhut/lx-music-desktop): original custom source protocol, platform music data formats, quality order, and desktop download behavior.
- [lxserver](https://github.com/XCQ0607/lxserver): a server-side project compatible with LX Music Desktop custom sources; used as a backend reference for source loading, resolver flow, music SDK usage, metadata handling, and quality fallback.
- [lx-music-source](https://github.com/pdone/lx-music-source): public custom source examples used for compatibility testing.
- [Netease_url](https://github.com/Suxiaoqinx/Netease_url): reference for optional NetEase cookie-based `wy` resolving.

Respect the licenses and usage rules of the referenced projects and any custom sources you import.
