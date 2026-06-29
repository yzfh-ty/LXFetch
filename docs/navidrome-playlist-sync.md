# Navidrome Playlist Sync Development Plan

This document describes how LXFetch should sync subscribed playlists and leaderboards into Navidrome as global library playlists.

## Goal

When a user subscribes to a playlist or leaderboard in LXFetch, LXFetch should keep downloading new songs as it does today and generate a matching playlist for Navidrome. The Navidrome playlist is intended to be visible to all Navidrome users who can access the shared music library.

## Chosen Approach

Use filesystem playlist export with Navidrome smart playlist (`.nsp`) files.

LXFetch writes `.nsp` JSON files under Navidrome's configured playlist directory. Navidrome imports those files during a library scan. This avoids direct playlist API writes and avoids mapping LXFetch source song IDs to Navidrome internal song IDs.

Do not use Subsonic `createPlaylist` or `updatePlaylist` for the first implementation. Those endpoints require Navidrome song IDs, which are only known after Navidrome scans downloaded files.

## User-Facing Behavior

- A subscribed LXFetch playlist produces one Navidrome playlist.
- A subscribed LXFetch leaderboard can also produce one Navidrome playlist.
- The playlist contains only songs that have already been downloaded and indexed by LXFetch.
- Songs discovered by a subscription but not downloaded yet are omitted until a later sync pass.
- Navidrome evaluates the generated smart playlist from the downloaded file paths. Smart playlists do not preserve upstream order.
- Generated smart playlists include `"public": true`, so they are visible to all Navidrome users with access to the library.
- If a song is upgraded to a higher-quality local file, a later export should point the playlist at the best indexed file.

## Relevant Existing Code

- `src/server/subscriptionManager.ts`
  - Stores subscriptions in `data/subscriptions.json`.
  - Fetches upstream playlist or leaderboard songs.
  - Creates download tasks during `SubscriptionManager.run`.
- `src/server/downloadIndex.ts`
  - Stores downloaded files in `downloads_index.json`.
  - `getDownloadedItemBySongInfo(songInfo)` maps a source song object to the best matching downloaded file.
- `src/server/downloadTaskManager.ts`
  - Creates and runs download tasks.
  - Calls `upsertDownloadIndex` after successful download and metadata processing.
- `src/config.ts`
  - Loads config from defaults, `config.js`, and environment variables.
- `src/server/router.ts`
  - Hosts subscription and download HTTP APIs.

## Proposed Data Flow

1. Scheduler or user action runs a subscription.
2. LXFetch fetches the full upstream song list for that subscription.
3. Existing subscription logic creates download tasks for missing or upgradable songs.
4. Playlist exporter receives the current upstream song list.
5. For each song, exporter calls `getDownloadedItemBySongInfo`.
6. Exporter writes an `.nsp` smart playlist matching only downloaded file paths.
7. Optional: LXFetch calls Navidrome's Subsonic `startScan` endpoint.
8. Navidrome imports or updates the playlist during scanning.

Because downloads are asynchronous, step 4 should also run periodically or after terminal task changes. The subscription run itself may finish before its created download tasks finish.

## Configuration

Add a `navidrome` section to `AppConfig`.

```ts
navidrome: {
  enabled: boolean
  playlistSyncEnabled: boolean
  playlistDir: string
  playlistPathMode: 'relative' | 'absolute'
  scanAfterExport: boolean
  baseUrl: string
  username: string
  password: string
  clientName: string
  apiVersion: string
}
```

Recommended defaults:

```ts
navidrome: {
  enabled: false,
  playlistSyncEnabled: false,
  playlistDir: './data/downloads/_playlists',
  playlistPathMode: 'relative',
  scanAfterExport: false,
  baseUrl: '',
  username: '',
  password: '',
  clientName: 'lxfetch',
  apiVersion: '1.16.1',
}
```

Environment variables:

| Variable | Description |
| --- | --- |
| `LXFETCH_NAVIDROME_ENABLED` | Enable Navidrome integration. |
| `LXFETCH_NAVIDROME_PLAYLIST_SYNC_ENABLED` | Enable `.nsp` smart playlist export. |
| `LXFETCH_NAVIDROME_PLAYLIST_DIR` | Directory where LXFetch writes `.nsp` files. |
| `LXFETCH_NAVIDROME_PLAYLIST_PATH_MODE` | `relative` or `absolute`; default `relative`. |
| `LXFETCH_NAVIDROME_SCAN_AFTER_EXPORT` | Call Navidrome scan after exporting playlists. |
| `LXFETCH_NAVIDROME_BASE_URL` | Navidrome base URL, for example `http://navidrome:4533`. |
| `LXFETCH_NAVIDROME_USERNAME` | Navidrome username for Subsonic API calls. |
| `LXFETCH_NAVIDROME_PASSWORD` | Navidrome password for Subsonic API calls. |

## Docker Layout

Recommended deployment:

```yaml
services:
  lxfetch:
    volumes:
      - ./data:/app/data
    environment:
      LXFETCH_DOWNLOAD_DIR: ./data/downloads
      LXFETCH_NAVIDROME_ENABLED: "true"
      LXFETCH_NAVIDROME_PLAYLIST_SYNC_ENABLED: "true"
      LXFETCH_NAVIDROME_PLAYLIST_DIR: ./data/downloads/_playlists
      LXFETCH_NAVIDROME_SCAN_AFTER_EXPORT: "true"
      LXFETCH_NAVIDROME_BASE_URL: http://navidrome:4533
      LXFETCH_NAVIDROME_USERNAME: admin
      LXFETCH_NAVIDROME_PASSWORD: change-me

  navidrome:
    image: deluan/navidrome:latest
    volumes:
      - ./data/downloads:/music:ro
      - ./navidrome-data:/data
    environment:
      ND_MUSICFOLDER: /music
      ND_PLAYLISTSPATH: _playlists
```

The key rule is that Navidrome must be able to see both the downloaded audio files and generated `.nsp` files. Navidrome's `ND_PLAYLISTSPATH` is relative to `ND_MUSICFOLDER`, so use `_playlists`, not `/music/_playlists`.

## NSP Format

Write UTF-8 `.nsp` JSON files.

Example:

```json
{
  "name": "My Playlist",
  "comment": "Generated by LXFetch",
  "public": true,
  "any": [
    { "is": { "filepath": "Song A - Artist.flac" } },
    { "is": { "filepath": "Song B - Artist.mp3" } }
  ]
}
```

`filepath` is relative to Navidrome's `MusicFolder`, not relative to the `.nsp` file.
Navidrome imports the smart playlist during a scan and refreshes its matched tracks when the playlist is opened or otherwise evaluated.

Example:

```text
data/downloads/
  Song A - Artist.flac
  Song B - Artist.mp3
  _playlists/
    My Playlist.nsp
```

Use absolute paths only if the operator explicitly configures matching paths in both containers. Relative paths are safer for Docker.

## Filename Rules

Playlist filenames must be sanitized independently from audio filenames.

Implemented naming rules:

- Use the upstream title directly when no other subscription has the same title.
- When multiple subscriptions have the same title, append the platform name, for example `飙升榜 (网易音乐)`.
- If the same platform has multiple subscriptions with the same title, append platform, type, and a short target ID.
- Use `data/navidrome_playlists.json` as the LXFetch-owned manifest that maps subscription IDs to generated `.nsp` filenames.
- Do not delete unknown `.nsp` files in the playlist directory.
- Only overwrite or delete files recorded in the LXFetch manifest.
- If a user-created file already occupies the preferred filename, add a numeric filename suffix while keeping the smart playlist `name` unchanged.

## New Module: `navidromePlaylistExporter.ts`

Responsibilities:

- Ensure the configured playlist directory exists.
- Build the latest song list for one subscription.
- Resolve downloaded files through `getDownloadedItemBySongInfo`.
- Generate deterministic `.nsp` smart playlist content.
- Write files atomically.
- Return sync stats.

Suggested public API:

```ts
export interface PlaylistExportResult {
  subscriptionId: string
  playlistFile: string
  title: string
  found: number
  downloaded: number
  missing: number
  skipped: number
  updated: boolean
}

export const exportSubscriptionPlaylist = async (
  subscription: Subscription,
  songs?: any[],
): Promise<PlaylistExportResult>

export const exportAllSubscriptionPlaylists = async (): Promise<PlaylistExportResult[]>
```

If `songs` is provided by `SubscriptionManager.run`, reuse it to avoid fetching the upstream list twice. If not provided, the exporter can call a new public method on `SubscriptionManager` that fetches songs for a subscription.

Current `fetchSongs` is private, so either:

- Add `getCurrentSongs(id: string)` to `SubscriptionManager`, or
- Move shared fetch logic into a small helper module.

Prefer adding a narrow `getCurrentSongs` method.

## New Module: `navidromeClient.ts`

Responsibilities:

- Call Navidrome-compatible Subsonic endpoints when configured.
- Start a library scan after playlist export.

Use Subsonic token auth:

```text
t = md5(password + salt)
s = salt
u = username
v = 1.16.1
c = lxfetch
f = json
```

Endpoint:

```text
GET /rest/startScan.view
```

Only call scan when all of these are true:

- `navidrome.enabled`
- `navidrome.scanAfterExport`
- `baseUrl`, `username`, and `password` are configured

Do not fail playlist export if scan fails. Return scan errors in sync stats or log a warning.

## Trigger Strategy

Use two triggers.

### 1. Subscription Run Trigger

After `SubscriptionManager.run` fetches songs and queues new tasks, call:

```ts
await exportSubscriptionPlaylist(subscription, songs)
```

This creates or updates the playlist immediately with songs already downloaded before this run.

### 2. Periodic Export Trigger

Add a lightweight scheduler that exports all enabled subscriptions every few minutes when playlist sync is enabled.

Reason: downloads created by a subscription may finish after `SubscriptionManager.run` returns. A later export is needed to add newly downloaded files to the smart playlist.

Recommended interval:

```text
5 minutes
```

Optional config:

```ts
playlistExportIntervalMinutes: number
```

This can be added later if fixed interval is acceptable for MVP.

## HTTP API

Add admin-only manual sync endpoints.

```http
POST /api/subscriptions/:id/navidrome-sync
```

Response:

```json
{
  "success": true,
  "result": {
    "subscriptionId": "sub_...",
    "playlistFile": "_playlists/songList-kw-123-title.nsp",
    "title": "title",
    "found": 120,
    "downloaded": 96,
    "missing": 24,
    "skipped": 0,
    "updated": true
  }
}
```

Optional:

```http
POST /api/subscriptions/navidrome-sync
```

Sync all subscriptions and return an array of results.

## Subscription State

The MVP can avoid mutating the subscription schema. Stats can be returned from the manual sync endpoint and logged from scheduled sync.

If UI visibility is needed later, add these fields:

```ts
lastPlaylistSyncedAt: number
lastPlaylistFile: string
lastPlaylistDownloadedCount: number
lastPlaylistMissingCount: number
lastPlaylistError: string
```

Avoid storing large song lists in `subscriptions.json`.

## Error Handling

Playlist export should be best effort.

- If Navidrome integration is disabled, return a no-op result or skip entirely.
- If playlist directory cannot be created, fail the sync endpoint and log scheduled sync errors.
- If an individual song has no stable song key, count it as skipped.
- If a downloaded index item points to a missing file, omit it.
- If Navidrome scan fails, keep the `.nsp` file and surface a scan warning.

## Security Notes

- Navidrome password should only come from `config.js` or environment variables.
- Do not expose Navidrome credentials through `GET /api/config`.
- Manual sync endpoints must require LXFetch admin auth.
- Do not allow arbitrary output paths from request bodies.
- Resolve playlist output inside configured `playlistDir` and avoid path traversal.

## Testing Plan

Unit-style tests or focused integration checks:

- `.nsp` content preserves UTF-8 names correctly.
- Smart playlist `filepath` values are relative to Navidrome `MusicFolder`.
- Missing downloaded files are omitted.
- Duplicate upstream songs appear only once.
- Playlist filename is stable for the same subscription.
- Export does not delete user-created `.nsp` files.
- Disabled Navidrome config does not export or scan.
- Scan failures do not remove generated `.nsp` files.

Manual Docker verification:

1. Start LXFetch and Navidrome with shared `./data/downloads`.
2. Subscribe to a small playlist.
3. Wait for at least one song to finish downloading.
4. Run manual sync endpoint.
5. Trigger Navidrome scan, or wait for scan.
6. Confirm playlist appears in Navidrome and contains downloaded songs.
7. Add or download another song, sync again, and confirm playlist updates.

## MVP Task Breakdown

1. Add `navidrome` config and environment parsing.
2. Add `navidromePlaylistExporter.ts`.
3. Add `navidromeClient.ts` with `startScan`.
4. Add manual sync endpoint for one subscription.
5. Call exporter after subscription runs.
6. Add periodic export scheduler.
7. Document Docker configuration in README or deployment docs.

## Known Limitations

- Playlists are global from Navidrome's library perspective.
- Navidrome will not show newly exported smart playlists until it scans; track counts may refresh when the smart playlist is opened.
- Smart playlists do not preserve the upstream playlist order; Navidrome applies its own smart playlist ordering.
- Songs that fail download or are still queued are omitted.
- Reordering depends on the latest upstream fetch and next export.
- Direct per-user private playlist sync is out of scope for this plan.

## References

- Navidrome Subsonic API compatibility: https://www.navidrome.org/docs/developers/subsonic-api/
- Subsonic API, including `startScan`, `createPlaylist`, and `updatePlaylist`: https://www.subsonic.org/pages/api.jsp
- Navidrome configuration options: https://www.navidrome.org/docs/usage/configuration-options/
