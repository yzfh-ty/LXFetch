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
    // Optional full NetEase Cloud Music cookie. When set, wy downloads try this first.
    // You can also set NETEASE_COOKIE in the environment.
    cookie: '',
    // Used when cookie is empty. The default reads the sibling Netease_url project cookie file.
    cookieFile: '../Netease_url/cookie.txt',
  },
  download: {
    dir: './data/downloads',
    // Number of active download tasks. Keep this low when quality is preferred over speed.
    maxConcurrent: 1,
    // Per-task bandwidth limit in bytes per second. 0 means unlimited.
    // Example: 1048576 limits each active task to about 1 MiB/s.
    throttleBytesPerSecond: 0,
    // Retry only interrupted/timeout/remote temporary download failures.
    maxRetries: 2,
    retryDelayMs: 2000,
    filenamePattern: '{name} - {singer}',
    embedCover: true,
    embedLyric: true,
    writeTags: true,
    verifyMetadata: true,
    // Cache fetched lyrics and covers under data/cache/metadata.
    cacheMetadata: true,
    // Cache cleanup keeps files younger than this and trims total size.
    metadataCacheMaxAgeDays: 90,
    metadataCacheMaxBytes: 200 * 1024 * 1024,
    // Skip creating a new download when the same song already exists locally.
    skipExisting: true,
    // If the existing local file is lower quality than the current song data explicitly reports, try downloading an upgraded version.
    upgradeExisting: true,
  },
  subscription: {
    // 0 means queue every newly discovered song in one update pass.
    // Positive values queue large subscriptions in batches across later updates.
    maxTasksPerRun: 0,
    // Delay between creating subscription download tasks.
    taskCreateDelayMs: 1500,
  },
  navidrome: {
    // When enabled with playlistSyncEnabled, LXFetch exports subscribed playlists as public Navidrome .nsp smart playlists.
    enabled: false,
    playlistSyncEnabled: false,
    // For the default local layout, Navidrome should mount the same downloads directory and read this subdirectory as playlists.
    playlistDir: './data/downloads/_playlists',
    // Use relative file paths unless the LXFetch and Navidrome containers share identical absolute music paths.
    playlistPathMode: 'relative',
    // Periodically refresh generated smart playlists so songs downloaded after a subscription run are added later.
    playlistExportIntervalMinutes: 5,
    // Optional: call Navidrome's Subsonic startScan endpoint after a generated playlist changes.
    scanAfterExport: false,
    baseUrl: '',
    username: '',
    password: '',
    clientName: 'lxfetch',
    apiVersion: '1.16.1',
  },
  localMatch: {
    // Match existing local audio files to subscribed playlists by priority and export public .nsp playlists.
    enabled: false,
    // Watch the download directory and re-run matching when local audio files change.
    watchEnabled: true,
    watchDebounceMs: 30000,
    // Also export a public smart playlist for files not matched by any subscription.
    includeUnmatchedPlaylist: true,
    unmatchedPlaylistName: '未匹配',
    // strict: source ID only; metadata: title/artist/album; duration: metadata plus duration tolerance.
    matchMode: 'duration',
    durationToleranceSeconds: 3,
  },
}
