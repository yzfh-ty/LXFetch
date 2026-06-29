# LXFetch 开发文档

## 1. 项目定位

`LXFetch` 是一个独立的本地 Web 音乐下载工具，复用 `lxserver` 中 LX 自定义音源、音乐 SDK、歌单、榜单、解析和元数据处理相关逻辑。

它只做下载相关功能：

- 导入并管理 LX/lxserver 兼容自定义音源。
- 搜索歌曲。
- 浏览歌单、用户歌单、榜单。
- 从搜索、歌单、榜单创建下载任务。
- 订阅歌单或榜单，运行服务期间定时发现新增歌曲并自动创建下载任务。
- 解析下载直链。
- 服务端下载文件。
- 获取封面和歌词。
- 写入标题、歌手、专辑、封面、歌词等标签。
- 下载后检查文件和元数据。
- 管理任务和已下载文件。

不包含播放器、收藏同步、歌单编辑、Subsonic、Electron、WebDAV、主题系统、远程同步服务等能力。

默认不内置任何可用解析音源。用户必须先导入并启用 LX/lxserver 兼容自定义源，才可以解析下载链接。

## 2. 运行方式

开发：

```bash
npm install
npm run dev
```

项目 `.npmrc` 默认使用 `https://registry.npmmirror.com` 安装 npm 依赖。

生产：

```bash
npm run build
npm start
```

访问：

```text
http://127.0.0.1:9528
```

LXFetch 不会安装后台服务。关闭 `npm start` 进程后，订阅调度和下载任务都会停止。

Docker：

```bash
docker build -t lxfetch .
mkdir -p data
docker run --rm -p 9528:9528 -v "$PWD/data:/app/data" lxfetch
```

Dockerfile 默认使用 `docker.1ms.run/node:24-bookworm-slim` 作为 Node 基础镜像，并使用 `https://registry.npmmirror.com` 安装 npm 依赖。

Docker Compose：

```bash
cp .env.example .env
docker compose up --build
```

Docker 运行时数据挂载到宿主机 `./data`，包括音源、订阅、任务、元数据缓存和下载文件。停止容器后，订阅调度和下载任务也会停止。

Docker Compose 会自动读取项目目录下的 `.env`。复制 `.env.example` 后只改 `.env`，不需要直接改 `docker-compose.yml`。

发布到 GitHub Container Registry 后可以这样运行：

```bash
mkdir -p data
docker pull ghcr.io/yzfh-ty/lxfetch:latest
docker run --rm -p 9528:9528 -v "$PWD/data:/app/data" ghcr.io/yzfh-ty/lxfetch:latest
```

`.github/workflows/docker.yml` 会在推送 `main`、推送 `v*` tag，或者在 GitHub Actions 手动运行时构建并发布镜像。默认发布到：

```text
ghcr.io/yzfh-ty/lxfetch
```

标签规则：

- `main` 分支发布 `latest`。
- `v0.1.0` 这类 tag 发布 `0.1.0` 和 `0.1`。
- 每次构建都会发布一个 `sha-*` 标签。

如需使用自定义配置：

```bash
cp config.example.js config.js
docker run --rm -p 9528:9528 \
  -v "$PWD/data:/app/data" \
  -v "$PWD/config.js:/app/config.js:ro" \
  lxfetch
```

使用已发布镜像时，把命令末尾的 `lxfetch` 替换成 `ghcr.io/yzfh-ty/lxfetch:latest`。

如果宿主机挂载的 `data` 目录不可写，可以按当前用户运行容器：

```bash
docker run --rm -p 9528:9528 \
  --user "$(id -u):$(id -g)" \
  -v "$PWD/data:/app/data" \
  lxfetch
```

## 3. 配置

复制示例配置：

```bash
cp config.example.js config.js
```

完整配置：

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

说明：

- 环境变量优先级高于 `config.js`，Docker 部署推荐使用 `.env` 配置。
- Docker Compose 会自动读取 `.env`，可以从 `.env.example` 复制。
- `auth.adminPassword` 为空时不要求管理员密码。
- `source.allowUnsafeVM` 默认关闭。只有确实需要兼容旧音源时才开启。
- `netease.cookie` 是可选的网易云音乐完整 Cookie。配置后，`wy` 平台下载会先用 Cookie 直解，失败后再回退到自定义音源。也可以用环境变量 `NETEASE_COOKIE`、`NETEASE_COOKIES` 或 `WY_COOKIE`。
- `netease.cookieFile` 会在 `netease.cookie` 为空时读取，默认是兄弟目录的 `../Netease_url/cookie.txt`。
- `download.maxConcurrent` 是同时下载任务数，默认 `1`。
- `download.throttleBytesPerSecond` 是单个下载任务的带宽限制，单位是 bytes/s，`0` 表示不限速。
- `download.maxRetries` 和 `download.retryDelayMs` 只对下载阶段的网络中断、超时、临时远端错误、不完整文件生效；音源解析失败不会反复重试。
- `download.filenamePattern` 默认是 `{name} - {singer}`。
- `download.cacheMetadata` 会把歌词和封面缓存到 `data/cache/metadata`，减少批量下载时的重复请求。
- `download.metadataCacheMaxAgeDays` 和 `download.metadataCacheMaxBytes` 用于缓存清理。
- `download.skipExisting` 会在本地已经存在同一首歌时跳过重复下载。
- `download.upgradeExisting` 会在本地文件音质低于当前歌曲数据明确报告的最高音质时继续下载升级版本，旧文件会保留。
- `subscription.maxTasksPerRun` 是每次订阅更新最多创建的任务数，`0` 表示不限制本次入队数量。设置为正数时会分批入队，例如 200 首榜单设置为 `50` 会每次最多创建 50 个任务，后续定时更新或手动立即更新继续创建下一批。
- `subscription.taskCreateDelayMs` 是订阅更新时每创建一个下载任务后的等待时间。

支持的环境变量：

```text
LXFETCH_HOST
LXFETCH_PORT
LXFETCH_ADMIN_PASSWORD
LXFETCH_ALLOW_UNSAFE_VM
NETEASE_COOKIE
NETEASE_COOKIES
WY_COOKIE
NETEASE_COOKIE_FILE
WY_COOKIE_FILE
LXFETCH_DOWNLOAD_DIR
LXFETCH_MAX_CONCURRENT
LXFETCH_THROTTLE_BYTES_PER_SECOND
LXFETCH_MAX_RETRIES
LXFETCH_RETRY_DELAY_MS
LXFETCH_FILENAME_PATTERN
LXFETCH_EMBED_COVER
LXFETCH_EMBED_LYRIC
LXFETCH_WRITE_TAGS
LXFETCH_VERIFY_METADATA
LXFETCH_CACHE_METADATA
LXFETCH_METADATA_CACHE_MAX_AGE_DAYS
LXFETCH_METADATA_CACHE_MAX_BYTES
LXFETCH_SKIP_EXISTING
LXFETCH_UPGRADE_EXISTING
LXFETCH_SUBSCRIPTION_MAX_TASKS_PER_RUN
LXFETCH_SUBSCRIPTION_TASK_CREATE_DELAY_MS
```

## 4. 当前功能范围

### 4.1 音源管理

- URL 导入脚本。
- 文件上传脚本。
- 验证脚本。
- 读取脚本注释元数据：`@name`、`@version`、`@author`、`@description`、`@homepage`。
- 运行脚本并等待 `lx.send('inited', { sources })`。
- 记录脚本支持的平台。
- 启用、禁用、删除、排序。
- Web 页面支持音源上移和下移，排序写入 `data/sources/order.json`。
- 默认使用 `vm2`。
- 可选 unsafe VM 兼容模式。

存储位置：

```text
data/sources/
  sources.json
  order.json
  scripts/
```

### 4.2 搜索、歌单、榜单

复用 `src/modules/utils/musicSdk` 中的平台 SDK。

支持：

- `kw`
- `kg`
- `tx`
- `wy`
- `mg`
- `xm`，仅保留平台定义，具体能力取决于 SDK。

功能：

- 搜索歌曲。
- 获取歌单标签。
- 获取歌单列表。
- 搜索歌单。
- 获取用户歌单。
- 获取歌单详情。
- 获取榜单列表。
- 获取榜单歌曲。

歌单详情和榜单详情会对歌曲对象做标准化，补齐 `source`、`songmid`、`types`、`_types`、`meta.qualitys`、`meta._qualitys` 等字段，以便直接下载。

### 4.3 音质策略

前端不传入固定音质。服务端统一按 `最高可用` 创建下载任务，并在解析失败时自动向下尝试。

质量顺序复用 `lxserver` 和 `lx-music-desktop` 的 `QUALITYS`：

```text
flac24bit -> flac -> wav -> ape -> 320k -> 192k -> 128k
```

行为：

- 根据歌曲已有音质信息从最高可用档开始尝试。
- 自定义音源声明的 `qualitys` 只作为展示和兼容信息，不作为下载解析的硬限制。部分 LX 兼容源会低报 `qualitys`，但实际接口仍能返回 FLAC；LXFetch 会主动尝试高音质，并用 URL 探测结果决定是否接受。
- 当前 Web 页面不提供固定音质选择，也不提供关闭降级入口。
- 解析失败时只在歌曲返回的可用音质范围内继续尝试下一档；如果歌曲数据没有 `types`、`_types`、`meta.qualitys`、`meta._qualitys` 等音质字段，才回退到完整顺序。
- 每个解析成功的 URL 都会先探测实际容器和大小；如果请求无损音质但返回 MP3 或明显低于预期大小，会拒绝该音质并继续尝试下一档。
- 歌单和榜单下载必须固定到打开该歌单/榜单时的音乐平台，不跨平台搜索或请求。例如 `kw` 榜单只使用 `kw` songInfo，`wy` 歌单只使用 `wy` songInfo。
- `wy` 平台如果配置了 `netease.cookie`，会优先调用网易云 Cookie 解析；该链接仍然经过实际 URL 探测，不符合请求音质时会拒绝并继续自定义音源流程。
- 多个自定义音源脚本都能解析同一平台、同一音质时，会探测 URL 的实际质量并选择分数更高的结果。
- 如果发生降级，任务中保留 `requestedQuality` 和最终 `quality`。

### 4.4 下载任务

任务状态：

```text
waiting
resolving
downloading
metadata_fetching
tagging
verifying
finished
failed
stopped
```

流程：

```text
createTask
  -> waiting
  -> resolving
  -> downloading
  -> metadata_fetching
  -> tagging
  -> verifying
  -> finished
```

关键行为：

- 队列并发由 `download.maxConcurrent` 控制。
- 下载速度可通过 `download.throttleBytesPerSecond` 限制。
- 下载时先写临时文件。
- 完成后检测文件类型并安全 rename。
- 文件名按 `filenamePattern` 生成并过滤非法字符。
- 重名时自动添加序号。
- 等待、解析、下载阶段的任务可以停止，下载中的请求会被中断并删除临时文件。
- 失败任务保留错误和 attempts。
- 支持批量重试失败任务。
- 支持批量停止可中断的活动任务。
- 支持批量清理完成、失败、停止的任务历史。

### 4.5 元数据

下载后保留：

- 封面下载。
- 歌词下载。
- 标题、歌手、专辑写入。
- 封面写入。
- 歌词写入。
- 元数据检查。
- 文件索引更新。

检查内容：

- 文件是否存在。
- 文件大小。
- 容器类型。
- duration。
- bitrate。
- sampleRate。
- bitDepth。
- title。
- artist。
- album。
- cover。
- lyrics。

封面或歌词失败不会阻断音频下载，但会写入任务和索引的警告状态。

### 4.6 订阅

订阅类型：

- 歌单订阅。
- 榜单订阅。

使用方式：

1. 打开歌单详情或榜单详情。
2. 点击 `订阅歌单` 或 `订阅榜单`。
3. 订阅会立即更新一次。
4. 服务运行期间按间隔自动检查。
5. 新发现歌曲会创建普通下载任务。

订阅限制：

- 每次最多抓取 20 页。
- 每次最多分析 500 首歌曲。
- 已下载歌曲和已入队歌曲会跳过。
- 无法生成有效歌曲 key 的条目会计入无效数量，不会创建下载任务。
- `subscription.maxTasksPerRun = 0` 时，本次发现的新歌全部入队。
- `subscription.maxTasksPerRun > 0` 时，本次只入队指定数量，剩余歌曲留到后续更新继续处理。
- `subscription.taskCreateDelayMs` 控制入队间隔。
- 真正下载仍受 `download.maxConcurrent` 控制。
- 可以重置订阅记录，清空已记录歌曲 key 后重新扫描入队。

存储位置：

```text
data/subscriptions.json
```

订阅不会在 LXFetch 进程停止后继续运行。

## 5. 数据文件

运行时数据：

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

`data/` 不应提交到仓库。

## 6. 数据模型

### 6.1 下载任务

```json
{
  "id": "task_xxx",
  "status": "waiting",
  "songInfo": {},
  "source": "kw",
  "quality": "flac",
  "requestedQuality": "flac24bit",
  "allowQualityFallback": true,
  "url": "",
  "sourceName": "",
  "attempts": [],
  "progress": 0,
  "received": 0,
  "total": 0,
  "speed": 0,
  "filename": "",
  "tempFilename": "",
  "error": "",
  "errorCategory": "",
  "retryCount": 0,
  "maxRetries": 2,
  "metadata": {
    "lyricFetched": false,
    "coverFetched": false,
    "tagsWritten": false,
    "verified": false,
    "verifyErrors": [],
    "verifyWarnings": [],
    "metadataErrors": []
  },
  "options": {
    "embedCover": true,
    "embedLyric": true,
    "writeTags": true,
    "verifyMetadata": true
  },
  "createdAt": 1782576000000,
  "updatedAt": 1782576000000
}
```

### 6.2 下载索引

```json
{
  "id": "kw_123_flac",
  "songId": "kw_123",
  "name": "Song",
  "singer": "Artist",
  "album": "Album",
  "albumId": "",
  "source": "kw",
  "quality": "flac",
  "filename": "Song - Artist.flac",
  "size": 12345678,
  "ext": "flac",
  "duration": "03:45",
  "bitrate": 900,
  "sampleRate": 44100,
  "bitDepth": 16,
  "actualQuality": "flac",
  "actualQualityLabel": "FLAC 16bit / 44kHz / 900kbps",
  "hasCover": true,
  "hasLyric": true,
  "hasEmbedLyric": true,
  "tagStatus": "ok",
  "verifyErrors": [],
  "verifyWarnings": [],
  "songInfo": {},
  "createdAt": 1782576000000,
  "updatedAt": 1782576000000
}
```

### 6.3 订阅

```json
{
  "id": "sub_xxx",
  "type": "songList",
  "source": "kw",
  "targetId": "123",
  "title": "Playlist Name",
  "enabled": true,
  "intervalMinutes": 360,
  "quality": "best",
  "allowQualityFallback": true,
  "options": {
    "embedCover": true,
    "embedLyric": true,
    "writeTags": true,
    "verifyMetadata": true
  },
  "downloadedKeys": ["kw:12345"],
  "lastCheckedAt": 1782576000000,
  "lastUpdatedAt": 1782576000000,
  "lastRunStatus": "success",
  "lastError": "",
  "lastFoundCount": 200,
  "lastCreatedCount": 12,
  "lastSkippedCount": 188,
  "lastInvalidCount": 0,
  "createdAt": 1782576000000,
  "updatedAt": 1782576000000
}
```

## 7. 后端模块

### 7.1 `customSourceHandlers.ts`

管理自定义源导入、上传、验证、启停、删除、排序。

### 7.2 `userApi.ts`

加载并运行自定义源脚本，提供 `callUserApiGetMusicUrl()`、`isSourceSupported()` 等能力。

必须保持兼容：

- `lx.request(url, options, callback)`
- `lx.send('inited', data)`
- `lx.on('request', handler)`
- `lx.utils.buffer`
- `lx.utils.crypto`
- `lx.utils.zlib`

### 7.3 `musicResolver.ts`

负责：

- 标准化 songInfo。
- 音质降级候选生成。
- 调用自定义源解析。
- 多音源质量探测选择。
- URL 重定向解析。
- 转发歌单和榜单接口。

### 7.4 `downloadTaskManager.ts`

负责：

- 下载队列。
- 并发控制。
- 可选带宽限速。
- 任务状态管理。
- 临时文件下载和 rename。
- 元数据获取、标签写入、检查。
- 下载索引更新。
- 停止和重试。

### 7.5 `metadataResolver.ts`

负责：

- 提取基础元数据。
- 获取歌词。
- 获取封面。
- 写入标签。
- 读取文件并检查元数据。

### 7.6 `downloadIndex.ts`

负责：

- 读写 `downloads_index.json`。
- 新增完成文件索引。
- 删除文件时同步删除索引。
- 按索引重建 songInfo。

### 7.7 `subscriptionManager.ts`

负责：

- 读写 `subscriptions.json`。
- 创建、启停、删除订阅。
- 定时检查到期订阅。
- 拉取歌单/榜单歌曲。
- 通过歌曲 key 去重。
- 按入队间隔创建下载任务。
- 统计发现、新建、跳过、无效歌曲数量。
- 重置订阅去重记录。

## 8. API

### 8.1 配置

`GET /api/config`

返回服务状态、下载配置、订阅配置和平台能力。

### 8.2 管理员

`POST /api/admin/verify`

```json
{ "password": "secret" }
```

### 8.3 音源

- `GET /api/sources`
- `POST /api/sources/validate`
- `POST /api/sources/import`
- `POST /api/sources/upload`
- `POST /api/sources/toggle`
- `POST /api/sources/delete`
- `POST /api/sources/reorder`

管理写操作需要管理员密码。

### 8.4 音乐

- `GET /api/music/platforms`
- `GET /api/music/search?source=kw&keyword=xxx&page=1&limit=30`
- `POST /api/music/resolve`
- `GET /api/music/songList/tags?source=kw`
- `GET /api/music/songList/list?source=kw&sortId=hot&tagId=&page=1`
- `GET /api/music/songList/detail?source=kw&id=123&page=1`
- `GET /api/music/songList/search?source=kw&text=xxx&page=1`
- `GET /api/music/songList/userPlaylist?source=tx&uid=123&page=1`
- `GET /api/music/leaderboard/boards?source=kw`
- `GET /api/music/leaderboard/list?source=kw&bangid=123&page=1`

`POST /api/music/resolve` 示例：

```json
{
  "songInfo": {}
}
```

### 8.5 下载任务

- `GET /api/download/tasks`
- `POST /api/download/tasks`
- `POST /api/download/tasks/clear`
- `POST /api/download/tasks/retry-failed`
- `POST /api/download/tasks/stop-active`
- `GET /api/download/tasks/:id`
- `POST /api/download/tasks/:id/stop`
- `POST /api/download/tasks/:id/retry`

`POST /api/download/tasks` 示例：

```json
{
  "songInfo": {},
  "options": {
    "embedCover": true,
    "embedLyric": true,
    "writeTags": true,
    "verifyMetadata": true
  }
}
```

### 8.6 已下载文件

- `GET /api/download/files`
- `GET /api/download/files/:filename`
- `DELETE /api/download/files/:filename`
- `POST /api/download/files/:filename/verify`
- `POST /api/download/files/:filename/rewrite-tags`

### 8.7 订阅

- `GET /api/subscriptions`
- `POST /api/subscriptions`
- `POST /api/subscriptions/:id/run`
- `POST /api/subscriptions/:id/toggle`
- `POST /api/subscriptions/:id/reset`
- `DELETE /api/subscriptions/:id`

`POST /api/subscriptions` 示例：

```json
{
  "type": "leaderboard",
  "source": "kw",
  "targetId": "16",
  "title": "榜单名",
  "intervalMinutes": 360,
  "options": {
    "embedCover": true,
    "embedLyric": true,
    "writeTags": true,
    "verifyMetadata": true
  }
}
```

## 9. 前端页面

菜单：

- 搜索下载。
- 歌单。
- 榜单。
- 订阅。
- 音源。
- 任务。
- 文件。
- 配置。

说明：

- 下载选项放在音源页面，包括封面、歌词、标签、检查。
- 音源页面支持上移和下移，控制多音源管理顺序。
- 歌单详情和榜单详情提供“下载本页”和“订阅”。
- 歌单详情本地分页，避免一次性展示过多歌曲。
- 榜单列表分页展示。
- 任务页展示状态、进度、速度、元数据状态、attempts。
- 任务页展示队列统计，支持批量重试失败任务、停止可中断任务、清理完成任务、清理失败/停止任务。
- 文件页支持下载、检查、重写标签、删除。
- 配置页只读展示当前服务端下载、订阅、音源能力和平台能力配置。

## 10. 安全要求

- 管理写操作要求管理员密码。
- 自定义源默认运行在 `vm2`。
- unsafe VM 必须由用户显式开启。
- 下载目录固定在配置目录内。
- 文件 API 必须防路径穿越。
- 文件名必须过滤非法字符。
- URL 导入只允许 `http:` 和 `https:`。
- 下载 URL 只允许 `http:` 和 `https:`。
- 管理员密码不写入前端源码。

## 11. 验证清单

基础：

- `node --check public/app.js`
- `npm run build`
- `npm start`
- `GET /api/config`
- `GET /api/sources`

音源：

- 导入普通自定义源。
- 导入需要 unsafe VM 的自定义源。
- 禁用和启用音源。
- 删除音源。

下载：

- 搜索并下载单曲，确认从最高可用音质开始解析。
- 从歌单当前页创建下载任务。
- 从榜单当前页创建下载任务。
- 验证高音质失败时自动降级。
- 下载中停止。
- 失败后重试。
- 批量重试失败任务。
- 批量停止可中断任务。
- 清理完成任务。
- 清理失败/停止任务。
- 查看 attempts。

歌单/榜单：

- 加载歌单标签。
- 加载歌单列表。
- 打开歌单详情。
- 歌单详情分页。
- 下载歌单当前页。
- 加载榜单列表。
- 打开榜单歌曲。
- 下载榜单当前页。

订阅：

- 订阅歌单。
- 订阅榜单。
- 立即更新订阅。
- 暂停和启用订阅。
- 重置订阅记录。
- 删除订阅。
- 确认重复歌曲不会重复入队。
- 确认停止服务后订阅不会继续运行。

元数据：

- 封面写入成功。
- 歌词写入成功。
- 标签写入成功。
- 元数据检查通过。
- 文件重新检查。
- 文件重写标签。
- 删除文件和索引。

## 12. 关键风险

- 自定义源脚本兼容性依赖 LX 环境注入，`lx.request` 和 `lx.utils` 不能随意删减。
- `vm2` 有安全维护风险，公开部署时必须谨慎。
- 部分平台歌词接口可能失效，歌词失败不能影响音频下载。
- 封面 URL 可能防盗链，需要 User-Agent 和 Referer。
- 无损格式标签写入失败率可能高于 MP3。
- 下载直链可能短期有效，失败重试应重新解析 URL。
- 订阅只在进程运行期间调度，不是系统级后台服务。
