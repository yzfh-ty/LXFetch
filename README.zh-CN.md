# LXFetch

简体中文 | [English](README.md)

LXFetch 是一个自托管的 Web 音乐下载工具，围绕 LX Music Desktop 兼容自定义音源构建。它专注于高音质本地下载、搜索、歌单、榜单、订阅更新、封面和歌词获取、音频标签写入，以及下载后的元数据检查。

LXFetch 默认不内置可用解析音源。开始下载前，需要先在 Web 页面导入并启用 LX Music Desktop 兼容自定义音源。

## 功能

- 导入、验证、启用、禁用、排序和删除 LX 自定义音源脚本。
- 搜索支持平台的歌曲。
- 浏览歌单、用户歌单和榜单。
- 从搜索结果、歌单和榜单创建下载任务。
- 订阅歌单或榜单，运行期间定时发现新增歌曲并自动入队下载。
- 多个自定义音源都能解析时，优先选择探测结果质量更高的链接。
- 始终从最高可用音质开始，只有必要时才自动降级。
- 写入标题、歌手、专辑、封面和歌词等音频标签。
- 下载后检查文件和元数据。
- 在本地 Web UI 管理任务、订阅、音源、已下载文件和运行配置。

## 要求

- Node.js 18 或更新版本。
- 至少一个 LX Music Desktop 兼容自定义音源脚本。

## 安装

```bash
npm install
```

## 开发运行

```bash
npm run dev
```

访问：

```text
http://127.0.0.1:9528
```

## 生产运行

```bash
npm run build
npm start
```

LXFetch 只在进程运行时工作，不会安装后台服务。关闭 `npm start` 后，下载任务和订阅调度都会停止。

## Docker

构建并运行：

```bash
docker build -t lxfetch .
mkdir -p data
docker run --rm -p 9528:9528 -v "$PWD/data:/app/data" lxfetch
```

访问：

```text
http://127.0.0.1:9528
```

使用 Docker Compose：

```bash
cp .env.example .env
docker compose up --build
```

Docker 运行数据保存在挂载的 `./data` 目录中，包括音源、订阅、任务、元数据缓存和下载文件。停止容器后，LXFetch 也会停止。

使用已发布的 GitHub Container Registry 镜像：

```bash
mkdir -p data
docker pull ghcr.io/yzfh-ty/lxfetch:latest
docker run --rm -p 9528:9528 -v "$PWD/data:/app/data" ghcr.io/yzfh-ty/lxfetch:latest
```

Docker Compose 会自动读取项目目录下的 `.env`。复制 `.env.example` 到 `.env` 后，只需要修改 `.env`，不需要直接修改 `docker-compose.yml`。

如果需要使用自定义 `config.js`：

```bash
cp config.example.js config.js
docker run --rm -p 9528:9528 \
  -v "$PWD/data:/app/data" \
  -v "$PWD/config.js:/app/config.js:ro" \
  lxfetch
```

使用已发布镜像时，把命令末尾的 `lxfetch` 替换为 `ghcr.io/yzfh-ty/lxfetch:latest`。

如果宿主机挂载的 `data` 目录不可写，可以按当前用户运行容器：

```bash
docker run --rm -p 9528:9528 \
  --user "$(id -u):$(id -g)" \
  -v "$PWD/data:/app/data" \
  lxfetch
```

## 配置

需要自定义配置时，可以复制示例文件：

```bash
cp config.example.js config.js
```

主要配置：

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

- 环境变量优先级高于 `config.js`，Docker 部署推荐使用 `.env`。
- Docker Compose 会自动读取 `.env`，可以从 `.env.example` 复制。
- `auth.adminPassword` 为空时，不要求管理员密码。
- `source.allowUnsafeVM` 默认关闭。只有确实需要兼容旧音源时才开启。
- `netease.cookie` 是可选的网易云音乐完整 Cookie。配置后，`wy` 平台下载会先用 Cookie 解析，失败后再回退到自定义音源。
- `netease.cookieFile` 会在 `netease.cookie` 为空时读取，默认是 `../Netease_url/cookie.txt`。
- `download.maxConcurrent` 是同时下载任务数，默认 `1`。
- `download.throttleBytesPerSecond` 是单个下载任务的带宽限制，单位 bytes/s，`0` 表示不限速。
- `download.maxRetries` 和 `download.retryDelayMs` 只对下载阶段的网络中断、超时、临时远端错误、不完整文件生效。
- `download.filenamePattern` 默认是 `{name} - {singer}`。
- `download.cacheMetadata` 会把歌词和封面缓存到 `data/cache/metadata`。
- `download.skipExisting` 会在本地已经存在同一首歌时跳过重复下载。
- `download.upgradeExisting` 会在本地文件音质低于当前歌曲数据明确报告的最高音质时继续下载升级版本。
- `subscription.maxTasksPerRun` 是每次订阅更新最多创建的任务数，`0` 表示本次全部入队。
- `subscription.taskCreateDelayMs` 是订阅更新时每创建一个下载任务后的等待时间。
- Web UI 的配置页只读。修改 `config.js` 或 `.env` 后需要重启 LXFetch。

## 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `NODE_ENV` | `production` | Node.js 运行模式。 |
| `LXFETCH_HOST` | `0.0.0.0` | HTTP 服务监听地址。Docker 中保持 `0.0.0.0`。 |
| `LXFETCH_PORT` | `9528` | HTTP 服务端口。Docker Compose 会用同一个值映射宿主机和容器端口。 |
| `LXFETCH_ADMIN_PASSWORD` | 空 | 管理员密码，用于音源管理等写操作。为空时不校验密码。 |
| `LXFETCH_ALLOW_UNSAFE_VM` | `false` | 启用不安全 VM 兼容模式。只有旧音源确实需要时才开启。 |
| `NETEASE_COOKIE` | 空 | 网易云音乐完整 Cookie。`wy` 下载会优先使用它解析。 |
| `NETEASE_COOKIES` | 空 | 网易云 Cookie 的备用环境变量名。 |
| `WY_COOKIE` | 空 | 网易云 Cookie 的备用环境变量名。 |
| `NETEASE_COOKIE_FILE` | 空 | 网易云 Cookie 文件路径。设置后会覆盖默认配置值。 |
| `WY_COOKIE_FILE` | 空 | 网易云 Cookie 文件路径的备用环境变量名。 |
| `LXFETCH_DOWNLOAD_DIR` | `./data/downloads` | 下载文件保存目录。Docker 中建议放在 `/app/data` 或挂载目录下。 |
| `LXFETCH_MAX_CONCURRENT` | `1` | 最大同时下载任务数。 |
| `LXFETCH_THROTTLE_BYTES_PER_SECOND` | `0` | 单任务下载限速，单位 bytes/s，`0` 表示不限速。 |
| `LXFETCH_MAX_RETRIES` | `2` | 下载中断、超时、临时错误或不完整文件的重试次数。 |
| `LXFETCH_RETRY_DELAY_MS` | `2000` | 下载失败后的重试等待时间，单位毫秒。 |
| `LXFETCH_FILENAME_PATTERN` | `{name} - {singer}` | 文件命名模板，支持 `{name}`、`{singer}`、`{album}`、`{source}`、`{quality}`、`{id}`。 |
| `LXFETCH_EMBED_COVER` | `true` | 将封面写入音频文件。 |
| `LXFETCH_EMBED_LYRIC` | `true` | 将歌词写入音频文件。 |
| `LXFETCH_WRITE_TAGS` | `true` | 写入标题、歌手、专辑、封面、歌词等标签。 |
| `LXFETCH_VERIFY_METADATA` | `true` | 标签写入后检查文件和元数据。 |
| `LXFETCH_CACHE_METADATA` | `true` | 缓存封面和歌词到 `data/cache/metadata`。 |
| `LXFETCH_METADATA_CACHE_MAX_AGE_DAYS` | `90` | 元数据缓存最大保留天数。 |
| `LXFETCH_METADATA_CACHE_MAX_BYTES` | `209715200` | 元数据缓存最大体积，单位 bytes。 |
| `LXFETCH_SKIP_EXISTING` | `true` | 本地已有同一首歌时跳过创建新任务。 |
| `LXFETCH_UPGRADE_EXISTING` | `true` | 本地文件音质较低时，允许下载更高音质版本。 |
| `LXFETCH_SUBSCRIPTION_MAX_TASKS_PER_RUN` | `0` | 每次订阅更新最多创建的新任务数，`0` 表示全部入队。 |
| `LXFETCH_SUBSCRIPTION_TASK_CREATE_DELAY_MS` | `1500` | 订阅批量创建任务的间隔，单位毫秒。 |

## 音质策略

下载始终从 `最高可用` 开始，前端不会传入固定音质。

LXFetch 遵循 LX Music Desktop 自定义音源的音质顺序，lxserver 也遵循这一套兼容逻辑：

```text
flac24bit -> flac -> wav -> ape -> 320k -> 192k -> 128k
```

LXFetch 会从歌曲数据报告的最高音质开始尝试，只有必要时才向下尝试。自定义音源声明的音质只作为提示，不作为下载解析的硬限制，因为部分 LX 兼容源会低报支持音质，但实际接口仍能返回无损链接。

解析出的 URL 会在下载前进行探测。如果请求无损音质但返回 MP3 或明显低于预期大小，LXFetch 会拒绝该音质并继续尝试下一档。

下载完成并写入元数据后，还会再次检查文件。已下载文件列表会保存请求音质和实际探测到的容器、码率、采样率等信息。

歌单和榜单下载会固定到当前平台，不跨平台搜索。例如酷我榜单只请求酷我 songInfo，网易云歌单只请求网易云 songInfo。如果多个启用的自定义音源都能解析同一平台和音质，LXFetch 会探测返回 URL 并选择质量分数更高的结果。

仅网易云 `wy` 平台支持配置 Cookie 优先解析。返回链接仍然会经过实际质量探测，不符合请求音质时会继续回退到自定义音源流程。

## 订阅

打开歌单或榜单详情页后，可以使用：

- `订阅歌单`
- `订阅榜单`

订阅信息保存在 `data/subscriptions.json`。LXFetch 运行期间，调度器会按配置间隔检查启用的订阅，并把新增歌曲加入下载队列。

已下载歌曲和之前已入队的订阅歌曲会跳过，避免重复下载。真正下载仍使用普通任务队列、元数据写入和检查流程。

开启 `upgradeExisting` 时，如果本地已有歌曲但音质低于当前歌曲数据报告的最高音质，订阅仍可以创建升级下载任务。

如果设置了 `maxTasksPerRun`，大型歌单或榜单会分批入队。例如 200 首榜单设置为 `50`，每次更新最多创建 50 个新任务，后续定时更新或手动立即更新会继续处理下一批。设置为 `0` 表示一次更新全部入队。

任务页面支持查看队列统计、批量重试失败任务、停止可中断任务，以及清理已完成、失败或已停止的任务历史。

订阅记录可以在 Web UI 中重置。当你希望重新扫描之前已入队但未成功下载的歌曲时，可以使用重置功能。

## 运行数据

运行数据保存在 `data/`：

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

`data/` 是本地运行状态，不应提交到仓库。

## 参考项目

LXFetch 是独立项目。它的主要兼容目标是 LX Music Desktop 的自定义音源协议，同时部分后端行为参考了相关兼容项目：

- [LX Music Desktop](https://github.com/lyswhut/lx-music-desktop)：自定义音源协议、平台音乐数据格式、音质顺序和桌面端下载行为的原始兼容目标。
- [lxserver](https://github.com/XCQ0607/lxserver)：同样兼容 LX Music Desktop 自定义音源的服务端项目；LXFetch 参考了它的自定义音源加载、LX 兼容用户 API、音乐 SDK 集成方式、歌单/榜单获取、解析流程、元数据处理和音质降级逻辑。
- [lx-music-source](https://github.com/pdone/lx-music-source)：用于导入音源和解析兼容性测试的公开 LX Music Desktop 自定义音源示例集合。
- [Netease_url](https://github.com/Suxiaoqinx/Netease_url)：参考其网易云音乐 Cookie 解析思路，用于 LXFetch 可选的 `wy` Cookie 优先解析路径。

LXFetch 与上述项目没有从属关系。请遵守参考项目及导入音源各自的许可证和使用规则。

## 常用命令

```bash
npm run build
npm start
node --check public/app.js
```
