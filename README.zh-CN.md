# LXFetch

简体中文 | [English](README.md)

LXFetch 是一个面向 LX Music Desktop 兼容自定义音源的自托管 Web 音乐下载工具。它提供本地 Web 页面，用于导入音源、搜索音乐、浏览歌单/榜单、下载高音质音频、写入封面/歌词元数据，并支持歌单或榜单订阅。

LXFetch 不内置解析音源。下载前需要先导入至少一个 LX Music Desktop 兼容自定义音源。

## 功能

- 导入、验证、启用、禁用、删除和排序 LX Music Desktop 兼容自定义音源。
- 搜索歌曲，浏览歌单、用户歌单和榜单。
- 从搜索结果、歌单和榜单创建下载任务。
- 订阅歌单或榜单，LXFetch 运行期间自动发现新增歌曲并加入下载队列。
- 从最高可用音质开始解析，必要时自动降级，并探测返回链接的实际质量。
- 写入封面、歌词、标题、歌手、专辑等标签，并在下载后检查文件和元数据。

## Docker 部署

新建目录，只下载部署需要的两个文件：

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

启动：

```bash
docker compose pull
docker compose up -d
```

访问：

```text
http://127.0.0.1:9528
```

运行状态保存在 `./data`，下载的音频文件保存在 `./downloads`。
容器启动时会自动修正挂载目录归属，然后按 `.env` 里的 `PUID:PGID` 运行应用。

更新：

```bash
docker compose pull
docker compose up -d
```

停止：

```bash
docker compose down
```

## 配置

Docker 部署推荐修改 `.env`。环境变量优先级高于 `config.js`。

常用变量：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `LXFETCH_IMAGE` | `ghcr.io/yzfh-ty/lxfetch:latest` | `docker-compose.yml` 使用的镜像。可改成 `ghcr.io/yzfh-ty/lxfetch:0.1.2` 固定版本。 |
| `PUID` | `1000` | 容器写入挂载目录使用的宿主机用户 ID，可用 `id -u` 获取。 |
| `PGID` | `1000` | 容器写入挂载目录使用的宿主机用户组 ID，可用 `id -g` 获取。 |
| `LXFETCH_PORT` | `9528` | Web 页面端口。 |
| `LXFETCH_ADMIN_PASSWORD` | 空 | 可选管理员密码。为空时不校验密码。 |
| `LXFETCH_DOWNLOAD_DIR` | `/app/downloads` | 容器内下载目录，`docker-compose.yml` 会映射到宿主机 `./downloads`。 |
| `LXFETCH_MAX_CONCURRENT` | `1` | 最大同时下载任务数。 |
| `LXFETCH_THROTTLE_BYTES_PER_SECOND` | `0` | 单任务限速，单位 bytes/s。`0` 表示不限速。 |
| `LXFETCH_FILENAME_PATTERN` | `{name} - {singer}` | 文件命名模板，支持 `{name}`、`{singer}`、`{album}`、`{source}`、`{quality}`、`{id}`。 |
| `LXFETCH_EMBED_COVER` | `true` | 写入封面。 |
| `LXFETCH_EMBED_LYRIC` | `true` | 写入歌词。 |
| `LXFETCH_WRITE_TAGS` | `true` | 写入音频标签。 |
| `LXFETCH_VERIFY_METADATA` | `true` | 检查下载文件和标签。 |
| `NETEASE_COOKIE` | 空 | 可选网易云音乐 Cookie，用于 `wy` 解析。 |
| `LXFETCH_SUBSCRIPTION_MAX_TASKS_PER_RUN` | `0` | 每次订阅更新最多创建的新任务数，`0` 表示全部入队。 |
| `LXFETCH_SUBSCRIPTION_TASK_CREATE_DELAY_MS` | `1500` | 订阅创建下载任务的间隔，单位毫秒。 |
| `LXFETCH_NAVIDROME_ENABLED` | `false` | 启用 Navidrome 集成。 |
| `LXFETCH_NAVIDROME_PLAYLIST_SYNC_ENABLED` | `false` | 将订阅自动导出为 Navidrome 可扫描的公开 `.nsp` 智能歌单。 |
| `LXFETCH_NAVIDROME_PLAYLIST_DIR` | `/app/downloads/_playlists` | `.nsp` 智能歌单输出目录。Navidrome 需要能读取该目录。 |
| `LXFETCH_NAVIDROME_PLAYLIST_PATH_MODE` | `relative` | 将 `filepath` 规则写成相对 Navidrome 音乐目录的路径。只有两个容器共享完全相同绝对路径时才用 `absolute`。 |
| `LXFETCH_NAVIDROME_PLAYLIST_EXPORT_INTERVAL_MINUTES` | `5` | 生成智能歌单的周期刷新间隔，单位分钟。 |
| `LXFETCH_NAVIDROME_SCAN_AFTER_EXPORT` | `false` | 歌单变化后调用 Navidrome/Subsonic 扫描接口。 |
| `LXFETCH_NAVIDROME_BASE_URL` | 空 | Navidrome 地址，例如 `http://navidrome:4533`。启用自动扫描时需要。 |
| `LXFETCH_NAVIDROME_USERNAME` | 空 | Navidrome 用户名。启用自动扫描时需要。 |
| `LXFETCH_NAVIDROME_PASSWORD` | 空 | Navidrome 密码。启用自动扫描时需要。 |

完整变量见 `.env.example`。

## Navidrome 歌单同步

启用 `LXFETCH_NAVIDROME_ENABLED=true` 和 `LXFETCH_NAVIDROME_PLAYLIST_SYNC_ENABLED=true` 后，LXFetch 会把订阅的歌单/榜单导出为 Navidrome `.nsp` 智能歌单，并在文件里写入 `"public": true`，方便所有 Navidrome 用户可见。无同名冲突时 Navidrome 歌单名使用原标题；多个订阅同名时会自动追加平台或短 ID 后缀区分。

Navidrome 会在媒体库扫描时导入生成的 `.nsp` 文件；智能歌单的曲目数量可能在 Navidrome 中打开歌单时刷新。

Navidrome 需要挂载同一个下载目录，并把歌单目录指向 `_playlists`：

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

## 本地开发

```bash
npm install
npm run dev
```

本地构建运行：

```bash
npm run build
npm start
```

## Docker 镜像

Docker 镜像只在推送 `v*` 标签时发布到 GitHub Container Registry。

```text
ghcr.io/yzfh-ty/lxfetch:latest
ghcr.io/yzfh-ty/lxfetch:0.1.2
ghcr.io/yzfh-ty/lxfetch:0.1
```

## 参考项目

LXFetch 是独立项目，主要兼容目标是 LX Music Desktop 的自定义音源协议。

- [LX Music Desktop](https://github.com/lyswhut/lx-music-desktop)：自定义音源协议、平台音乐数据格式、音质顺序和桌面端下载行为的原始兼容目标。
- [lxserver](https://github.com/XCQ0607/lxserver)：同样兼容 LX Music Desktop 自定义音源的服务端项目；LXFetch 参考了它的音源加载、解析流程、音乐 SDK 使用、元数据处理和音质降级逻辑。
- [lx-music-source](https://github.com/pdone/lx-music-source)：用于兼容性测试的公开自定义音源示例集合。
- [Netease_url](https://github.com/Suxiaoqinx/Netease_url)：参考其网易云 Cookie 解析思路，用于可选的 `wy` Cookie 解析路径。

请遵守参考项目及导入音源各自的许可证和使用规则。
