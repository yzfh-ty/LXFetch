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
    // You can also set NETEASE_COOKIE, NETEASE_COOKIES, or WY_COOKIE in the environment.
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
    filenamePattern: '{name} - {singer}',
    embedCover: true,
    embedLyric: true,
    writeTags: true,
    verifyMetadata: true,
  },
  subscription: {
    // 0 means queue every newly discovered song in one update pass.
    // Positive values queue large subscriptions in batches across later updates.
    maxTasksPerRun: 0,
    // Delay between creating subscription download tasks.
    taskCreateDelayMs: 1500,
  },
}
