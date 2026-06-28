# LXFetch

LXFetch is a self-hosted web music downloader built around LX-compatible custom sources. It focuses on high-quality downloads, playlist and leaderboard browsing, cover and lyric collection, audio tag writing, and post-download metadata verification.

## Features

- Import, validate, enable, disable, reorder, and delete LX custom source scripts.
- Search songs across supported music platforms.
- Browse playlists, user playlists, and leaderboards exposed by the LX music SDK.
- Download single songs or the current page of playlist/leaderboard results.
- Prefer higher-quality audio when multiple custom sources return usable links.
- Write title, artist, album, cover, and lyrics into downloaded audio files.
- Verify downloaded files and metadata after each task.
- Manage download tasks and completed files from a local web UI.

## Development

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:9528`.

Copy `config.example.js` to `config.js` to customize the port, admin password, and download directory.

## Production Run

```bash
npm run build
npm start
```
