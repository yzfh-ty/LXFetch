# LXFetch 开发文档

## 1. 项目定位

`LXFetch` 是从当前 `lxserver` 项目拆出的独立 Web 下载工具。它只做音乐下载相关能力，但下载链路必须保留完整元数据处理：

- 导入和启用 LX 自定义音源。
- 搜索歌曲或粘贴 songInfo。
- 浏览 lxserver SDK 支持的歌单和榜单，并从歌单/榜单歌曲创建下载任务。
- 通过自定义音源解析下载直链。
- 服务端下载音乐文件。
- 下载歌词、封面等元数据。
- 写入音频标签，包括标题、歌手、专辑、封面、歌词。
- 下载完成后检查文件和元数据，生成本地索引。
- Web 页面管理音源、歌单/榜单浏览、任务和已下载文件。

不迁移播放器、同步服务、收藏同步、歌单编辑、Subsonic、Electron、主题、文件管理器等与下载无关的能力。

默认状态下不内置任何可用解析音源。用户必须先导入并启用音源脚本，后续搜索结果才能解析下载链接。音源协议必须与当前 `lxserver` 项目一致，也就是兼容 `lxserver` 已支持的 LX 自定义源脚本格式。

## 2. lxserver 可复用逻辑

### 2.1 自定义音源

来源：

- `lxserver/src/server/customSourceHandlers.ts`
- `lxserver/src/server/userApi.ts`
- `lxserver/src/modules/utils/musicSdk/api-source.js`

`LXFetch` 不提供内置兜底解析接口。这里沿用 `lxserver` 当前行为：服务器端优先且只使用用户导入并启用的自定义音源；没有启用支持目标平台的音源时，解析接口直接返回“未找到支持该平台的自定义源”。

保留能力：

- URL 导入脚本。
- 文件上传脚本。
- 脚本验证。
- 解析脚本注释元数据：`@name`、`@version`、`@author`、`@description`、`@homepage`。
- 运行脚本并等待 `lx.send('inited', { sources })`。
- 记录脚本支持的平台。
- 启用、禁用、删除、排序。
- `vm2` 安全模式。
- 显式确认后的原生 `vm` 兼容模式。
- `callUserApiGetMusicUrl()` 的 songInfo 标准化、多源轮询、失败 attempts 记录。

裁剪内容：

- 多用户 open/user 合并逻辑第一版不保留。
- 公开源/私有源覆盖规则第一版不保留。
- 与播放器会话、用户 Token、同步服务相关的鉴权逻辑不迁移。

### 2.2 搜索和解析

来源：

- `lxserver/src/modules/utils/musicSdk/index.js`
- 各平台 SDK：`kw`、`kg`、`tx`、`wy`、`mg`
- `lxserver/src/server/server.ts` 中 `/api/music/url`
- `lxserver/src/server/server.ts` 中 `/api/music/songList/*` 和 `/api/music/leaderboard/*`

保留能力：

- 平台搜索。
- 歌曲对象字段兼容。
- `source` 平台识别。
- 音质字段兼容：`types`、`_types`、`meta.qualitys`、`meta._qualitys`。
- 下载 URL 解析后的重定向检查。
- 解析 attempts 返回到前端。
- 歌单分类、歌单列表、歌单详情、歌单搜索、用户歌单。
- 榜单列表、榜单歌曲列表。
- 歌单/榜单详情里的歌曲对象标准化，确保 `types`、`_types`、`songmid`、`source` 等字段可用于下载。

### 2.3 下载和元数据

重点来源：

- `lxserver/src/server/fileCache.ts`
- `lxserver/src/server/server.ts` 中 `/api/music/download`
- `lxserver/src/common/utils/download/*`
- `lxserver/src/utils/lrcTool.ts`

必须保留能力：

- 下载临时文件：`*.tmp`。
- 成功后安全 rename。
- 根据 HTTP `content-type` 和 `file-type` 检测扩展名。
- 文件名清理和冲突处理。
- 下载进度：状态、百分比、已下载、总大小、速度。
- 停止任务时中断请求并清理临时文件。
- 下载封面图片。
- 下载歌词。
- 写入音频标签：
  - title
  - artist
  - album
  - cover picture
  - lyrics
- 下载后重新读取文件，检查：
  - 文件存在。
  - 文件大小有效。
  - 音频容器可识别。
  - duration 可读。
  - bitrate/sampleRate/bitDepth 可读。
  - 封面是否写入。
  - 歌词是否写入。
  - 本地索引是否更新。

裁剪内容：

- `cache` 和 `music` 双目录语义改成单一 `downloads` 目录。
- 服务器播放缓存检查不迁移。
- 缓存大小自动清理第一版不做。
- 歌词卡片、播放代理、播放器 Range 拖拽不迁移。

## 3. 第一版功能范围

### 3.1 必做

- Web 页面。
- 管理员密码。
- 自定义音源导入、上传、验证、启用、删除、排序。
- 搜索歌曲。
- 浏览、搜索歌单。
- 获取用户歌单。
- 浏览榜单。
- 从歌单和榜单歌曲下载。
- 批量创建当前页下载任务。
- 粘贴 songInfo JSON 下载。
- 选择音质。
- 解析直链。
- 下载任务队列。
- 下载进度轮询。
- 停止任务。
- 失败重试。
- 歌词、封面、标签写入。
- 下载后元数据检查。
- 已下载文件列表。
- 文件重新检查元数据。
- 文件重新写入标签。
- 浏览器下载已完成文件。
- 删除已下载文件。

### 3.2 暂不做

- 播放器。
- 收藏同步和歌单编辑。
- 同步服务。
- 多用户。
- Subsonic。
- Electron。
- WebDAV。
- 文件管理器。
- 主题、音效、可视化。

## 4. 技术栈

- Node.js 18+。
- TypeScript。
- Node 原生 `http` 或极轻量路由层。
- 前端使用静态 HTML/CSS/JavaScript。
- 本地 JSON 文件保存音源、任务、下载索引。
- `music-tag-native` 写入和检查音频标签。
- `file-type` 检测文件类型。
- `vm2` 运行普通自定义源脚本。

保持和 `lxserver` 相近的技术栈，迁移成本最低。

## 5. 建议目录结构

```text
lxfetch/
  DEVELOPMENT.md
  README.md
  package.json
  tsconfig.json
  config.example.js
  src/
    index.ts
    config.ts
    server/
      router.ts
      static.ts
      auth.ts
      customSourceHandlers.ts
      userApi.ts
      musicResolver.ts
      metadataResolver.ts
      downloadTaskManager.ts
      downloadIndex.ts
      fileStore.ts
    modules/
      musicSdk/
    common/
      utils/
        download/
        lrcTool.ts
  public/
    index.html
    app.js
    style.css
  data/
    sources/
      sources.json
      order.json
    downloads/
      downloads_index.json
    tasks.json
```

`data/` 是运行时目录，不提交到仓库。

## 6. 配置设计

`config.example.js`：

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
  download: {
    dir: './data/downloads',
    maxConcurrent: 3,
    filenamePattern: '{name} - {singer}',
    embedCover: true,
    embedLyric: true,
    writeTags: true,
    verifyMetadata: true,
  },
}
```

说明：

- `allowUnsafeVM` 默认关闭。
- `embedCover`、`embedLyric`、`writeTags` 默认开启。
- `verifyMetadata` 默认开启，下载完成后必须检查音频文件和标签状态。

## 7. 数据模型

### 7.1 音源

```json
{
  "id": "source-name.js",
  "name": "Source Name",
  "version": "1.0.0",
  "author": "unknown",
  "description": "",
  "homepage": "",
  "enabled": true,
  "supportedSources": ["kw", "kg", "tx"],
  "allowUnsafeVM": false,
  "requireUnsafe": false,
  "uploadTime": "2026-06-28T00:00:00.000Z"
}
```

### 7.2 下载任务

```json
{
  "id": "task_xxx",
  "status": "waiting",
  "songInfo": {},
  "source": "kw",
  "quality": "320k",
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
  "metadata": {
    "lyricFetched": false,
    "coverFetched": false,
    "tagsWritten": false,
    "verified": false,
    "verifyErrors": []
  },
  "createdAt": 1782576000000,
  "updatedAt": 1782576000000
}
```

任务状态：

- `waiting`
- `resolving`
- `downloading`
- `metadata_fetching`
- `tagging`
- `verifying`
- `finished`
- `failed`
- `stopped`

### 7.3 下载索引

```json
{
  "id": "kw_123_320k",
  "songId": "kw_123",
  "name": "Song",
  "singer": "Artist",
  "album": "Album",
  "albumId": "",
  "source": "kw",
  "quality": "320k",
  "filename": "Artist - Song - 320k.mp3",
  "size": 12345678,
  "ext": "mp3",
  "duration": "03:45",
  "bitrate": 320,
  "sampleRate": 44100,
  "bitDepth": 16,
  "hasCover": true,
  "hasLyric": true,
  "hasEmbedLyric": true,
  "tagStatus": "ok",
  "verifyErrors": [],
  "createdAt": 1782576000000,
  "updatedAt": 1782576000000
}
```

## 8. 后端模块设计

### 8.1 `customSourceHandlers.ts`

职责：

- 读取请求体。
- 导入远程脚本。
- 上传本地脚本。
- 验证脚本。
- 保存脚本和 `sources.json`。
- 更新 `order.json`。
- 调用 `initUserApis()` 重新加载。

和 `lxserver` 的差异：

- 存储路径固定为 `data/sources`。
- 不区分公开源和用户源。
- 所有修改操作都要求管理员密码。

### 8.2 `userApi.ts`

职责：

- 运行自定义源脚本。
- 注入 LX 兼容 API。
- 维护 loadedApis。
- 提供 `callUserApiGetMusicUrl()`。
- 提供 `isSourceSupported()`。
- 提供 `getLoadedApis()`。

必须保持兼容：

- `lx.request(url, options, callback)`
- `lx.send('inited', data)`
- `lx.on('request', handler)`
- `lx.utils.buffer`
- `lx.utils.crypto`
- `lx.utils.zlib`

### 8.3 `musicResolver.ts`

职责：

- 标准化 songInfo。
- 调用 `callUserApiGetMusicUrl()`。
- 解析重定向。
- 返回 `url`、`type`、`sourceName`、`attempts`。
- 转发 lxserver SDK 的歌单/榜单能力。
- 对歌单/榜单返回的歌曲做标准化，补齐元数据和音质字段。

接口：

```ts
async function resolveMusicUrl(input: {
  songInfo: any
  quality: string
  enableAutoSwitchApiSource?: boolean
}): Promise<{
  url: string
  type: string
  sourceName?: string
  attempts: Array<{ name: string; status: string; message?: string }>
}>
```

歌单/榜单接口：

```ts
getSongListTags(source)
getSongLists(source, sortId, tagId, page)
getSongListDetail(source, id, page)
searchSongLists(source, text, page)
getUserPlaylist(source, uid, page)
getLeaderboardBoards(source)
getLeaderboardList(source, bangid, page)
```

### 8.4 `metadataResolver.ts`

职责：

- 从 songInfo 提取基础元数据。
- 获取歌词。
- 获取封面。
- 生成待写入标签的数据。
- 下载后读取文件元数据并验证。

基础元数据字段：

- `name`
- `singer`
- `album`
- `albumId`
- `img`
- `interval`
- `source`
- `songmid`
- `quality`

歌词来源：

1. 优先使用平台 SDK 的 `getLyric(songInfo)`。
2. 如果 songInfo 已带歌词字段，则作为兜底。
3. 失败不阻断音频下载，但要记录 `lyricFetched: false` 和错误原因。

封面来源：

1. `songInfo.img`
2. `songInfo.meta.picUrl`
3. 平台 SDK 的 pic 接口，若当前平台已有可用实现。

验证字段：

- 文件大小。
- 文件类型。
- duration。
- bitrate。
- sampleRate。
- bitDepth。
- title。
- artist。
- album。
- cover。
- lyrics。

### 8.5 `downloadTaskManager.ts`

职责：

- 管理并发。
- 创建任务。
- 解析 URL。
- 下载临时文件。
- 获取元数据。
- 写入标签。
- 校验文件。
- 更新下载索引。
- 停止和重试。

推荐流程：

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

失败流程：

```text
resolving failed
  -> failed，保留 attempts

downloading failed
  -> failed，删除 tmp，保留错误

metadata_fetching failed
  -> 继续 tagging，但记录元数据缺失

tagging failed
  -> failed 或 metadata_failed，第一版建议 failed，避免用户误以为完整下载

verifying failed
  -> failed，文件可保留但索引标记 verifyErrors
```

### 8.6 `downloadIndex.ts`

职责：

- 读写 `downloads_index.json`。
- 新增完成文件。
- 删除文件时同步删除索引。
- 重新扫描下载目录。
- 重新检查单个文件元数据。
- 重新写入单个文件标签。

## 9. API 设计

### 9.1 管理员

`POST /api/admin/verify`

Header：

- `x-admin-password`

返回：

```json
{ "success": true }
```

### 9.2 音源

`POST /api/sources/validate`

```json
{
  "script": "...",
  "allowUnsafeVM": false
}
```

`POST /api/sources/import`

```json
{
  "url": "https://example.com/source.js",
  "filename": "source.js",
  "allowUnsafeVM": false
}
```

`POST /api/sources/upload`

```json
{
  "filename": "source.js",
  "content": "...",
  "allowUnsafeVM": false
}
```

`GET /api/sources`

`POST /api/sources/toggle`

```json
{
  "id": "source.js",
  "enabled": true,
  "allowUnsafeVM": false
}
```

`POST /api/sources/delete`

```json
{ "id": "source.js" }
```

`POST /api/sources/reorder`

```json
{ "ids": ["a.js", "b.js"] }
```

### 9.3 音乐

`GET /api/music/search?source=kw&keyword=xxx&page=1&limit=30`

返回平台搜索结果，结果必须保留原始字段，避免解析时字段缺失。

`POST /api/music/resolve`

```json
{
  "songInfo": {},
  "quality": "320k",
  "enableAutoSwitchApiSource": true
}
```

`GET /api/music/songList/tags?source=wy`

返回歌单分类标签和排序方式。

`GET /api/music/songList/list?source=wy&sortId=hot&tagId=华语&page=1`

返回歌单列表。

`GET /api/music/songList/detail?source=wy&id=123&page=1`

返回歌单详情和歌曲列表，歌曲可直接提交到 `/api/download/tasks`。

`GET /api/music/songList/search?source=wy&text=关键词&page=1`

搜索歌单。

`GET /api/music/songList/userPlaylist?source=tx&uid=123&page=1`

返回用户歌单。当前主要兼容 QQ 音乐 SDK。

`GET /api/music/leaderboard/boards?source=wy`

返回榜单列表。

`GET /api/music/leaderboard/list?source=wy&bangid=19723756&page=1`

返回榜单歌曲列表，歌曲可直接提交到 `/api/download/tasks`。

返回：

```json
{
  "url": "https://...",
  "type": "320k",
  "sourceName": "Custom Source",
  "attempts": []
}
```

### 9.4 下载任务

`POST /api/download/tasks`

```json
{
  "songInfo": {},
  "quality": "320k",
  "url": "",
  "options": {
    "embedCover": true,
    "embedLyric": true,
    "writeTags": true,
    "verifyMetadata": true
  }
}
```

如果 `url` 为空，服务端先解析。

`GET /api/download/tasks`

返回所有任务。

`GET /api/download/tasks/:id`

返回单个任务。

`POST /api/download/tasks/:id/stop`

停止任务。

`POST /api/download/tasks/:id/retry`

重新解析并下载。

### 9.5 已下载文件

`GET /api/download/files`

返回下载索引。

`GET /api/download/files/:filename`

下载文件。

`DELETE /api/download/files/:filename`

删除文件和索引。

`POST /api/download/files/:filename/verify`

重新读取文件并检查元数据。

`POST /api/download/files/:filename/rewrite-tags`

根据索引和 songInfo 重新写入标签、封面、歌词。

## 10. Web 页面设计

第一屏就是工具本体，不做落地页。

布局：

```text
顶部工具栏
  - LXFetch
  - 管理员登录状态
  - 下载目录状态

左侧栏：音源
  - URL 导入
  - 文件上传
  - 音源列表
  - 启用开关
  - 支持平台
  - 运行状态和错误

主区域：搜索和下载
  - 平台选择
  - 关键词输入
  - 搜索结果表格
  - 音质选择
  - 下载按钮
  - 歌单 tab：分类标签、歌单搜索、用户歌单、歌单详情、下载本页
  - 榜单 tab：榜单列表、榜单歌曲、下载本页
  - 粘贴 songInfo JSON 模式

右侧栏：任务
  - 状态
  - 进度
  - 速度
  - 当前阶段：解析、下载、元数据、标签、检查
  - 停止、重试、查看 attempts

底部：已下载文件
  - 文件名
  - 歌曲、歌手、专辑
  - 音质、大小、时长
  - 封面状态
  - 歌词状态
  - 标签检查状态
  - 下载、重新检查、重写标签、删除
```

界面状态要求：

- 没有音源时，引导导入音源。
- 没有启用支持该平台的音源时，搜索可用但下载按钮禁用或提示。
- 解析失败时展示 attempts。
- 元数据写入失败时展示具体字段。
- 文件已下载但检查失败时允许重写标签。

## 11. 元数据写入细节

### 11.1 标签写入

使用 `music-tag-native`：

- `tagger.title = name`
- `tagger.artist = singer`
- `tagger.album = album`
- `tagger.pictures = [new MetaPicture(...)]`
- `tagger.lyrics = lyricText`
- `tagger.save()`

写入后必须 `dispose()`。

### 11.2 封面处理

- 只接受 http/https 图片 URL。
- 下载超时建议 8 秒。
- 图片下载失败不重试超过 1 次。
- MIME 优先从响应头读取，否则默认 `image/jpeg`。
- 写入失败要记录 `coverWriteError`。

### 11.3 歌词处理

- 支持普通 LRC 文本。
- 支持平台 SDK 返回的 `lyric`、`lrc` 字段。
- 如果有翻译歌词，第一版可以先只写主歌词。
- 写入 USLT 标签。
- 未来可扩展为同名 `.lrc` 旁路文件。

### 11.4 下载后检查

检查流程：

```text
MusicTagger.loadPath(file)
  -> 读取 duration
  -> 读取 bitRate
  -> 读取 sampleRate
  -> 读取 bitDepth
  -> 读取 title/artist/album
  -> 检查 pictures
  -> 检查 lyrics
  -> 更新 downloads_index.json
```

判定：

- 文件不存在：失败。
- 文件小于 100 字节：失败。
- tagger 无法读取：失败。
- title/artist 缺失：警告。
- 开启封面写入但无封面：警告。
- 开启歌词写入但无歌词：警告。
- duration 缺失：警告或失败，第一版建议警告。

## 12. 安全要求

- 所有管理接口要求管理员密码。
- 自定义源默认 `vm2`。
- 原生 `vm` 必须显式开启并二次确认。
- 下载目录固定，禁止请求指定任意绝对路径。
- 文件名必须过滤：`\\ / : * ? " < > |`。
- 文件 API 必须防路径穿越。
- URL 导入只允许 `http:` 和 `https:`。
- 下载 URL 只允许 `http:` 和 `https:`。
- 不把管理员密码写入前端源码。

## 13. 实施计划

### Phase 1：项目骨架

- 创建 `package.json`、`tsconfig.json`、`src/index.ts`。
- 实现配置加载。
- 实现静态文件服务。
- 实现 JSON body 解析。
- 实现管理员验证。

### Phase 2：音源管理

- 迁移 `customSourceHandlers.ts`。
- 迁移 `userApi.ts`。
- 简化为单目录 `data/sources`。
- 启动时加载启用音源。
- 完成音源管理 API。

### Phase 3：搜索和解析

- 迁移必要 `musicSdk`。
- 解决路径别名。
- 完成 `/api/music/search`。
- 完成 `/api/music/resolve`。
- 确认自定义源 attempts 能返回前端。

### Phase 3.5：歌单和榜单

- 完成 `/api/music/songList/tags`。
- 完成 `/api/music/songList/list`。
- 完成 `/api/music/songList/detail`。
- 完成 `/api/music/songList/search`。
- 完成 `/api/music/songList/userPlaylist`。
- 完成 `/api/music/leaderboard/boards`。
- 完成 `/api/music/leaderboard/list`。
- 前端增加歌单和榜单 tab，歌曲下载复用任务队列。

### Phase 4：下载和元数据

- 实现 `downloadTaskManager.ts`。
- 实现 `metadataResolver.ts`。
- 实现 `downloadIndex.ts`。
- 保留封面、歌词、标签写入。
- 实现下载后检查。
- 实现重写标签和重新检查。

### Phase 5：Web 页面

- 完成音源面板。
- 完成搜索和 songInfo 粘贴模式。
- 完成任务队列。
- 完成已下载文件列表。
- 完成 attempts 和元数据错误展示。

### Phase 6：验证

手工验证：

- 导入普通自定义源。
- 导入需要 unsafe VM 的自定义源。
- 搜索并下载 `128k`。
- 搜索并下载 `320k`。
- 搜索并下载 `flac`。
- 从歌单详情创建下载任务。
- 从榜单详情创建下载任务。
- 下载中停止。
- 解析失败展示 attempts。
- 下载失败展示 HTTP/网络错误。
- 下载完成后封面写入成功。
- 下载完成后歌词写入成功。
- 重新检查元数据。
- 重新写入标签。
- 删除文件。

自动测试：

- 文件名清理。
- 路径穿越拦截。
- 音源元数据解析。
- songInfo 标准化。
- 下载任务状态转换。
- 下载索引读写。
- 元数据检查结果合并。

## 14. 关键风险

- 自定义源脚本兼容性依赖 LX 环境注入，`lx.request` 和 `lx.utils` 不能随意删减。
- `vm2` 有安全维护风险，公开部署时必须谨慎。
- 部分平台歌词接口可能失效，歌词失败不能影响音频下载，但必须在检查结果里可见。
- 封面 URL 可能防盗链，需要合理设置 User-Agent 和 Referer。
- 无损格式标签写入失败率可能高于 MP3，需要在验证阶段重点测试 FLAC。
- 下载直链可能短期有效，失败重试应重新解析 URL。
