const ADMIN_STORAGE_KEY = 'lxfetch_admin';
const LEGACY_ADMIN_STORAGE_KEY = 'lxdownload_admin';
const SUBSCRIPTION_INTERVAL_STORAGE_KEY = 'lxfetch_subscription_interval';

const QUALITY_LABELS = {
  best: '最高可用',
  master: 'Master',
  flac24bit: 'FLAC 24bit',
  flac: 'FLAC',
  wav: 'WAV',
  ape: 'APE',
  '320k': '320k',
  '192k': '192k',
  '128k': '128k',
};

const state = {
  adminPassword: localStorage.getItem(ADMIN_STORAGE_KEY) || localStorage.getItem(LEGACY_ADMIN_STORAGE_KEY) || '',
  config: null,
  platforms: [],
  sources: [],
  tasks: [],
  files: [],
  subscriptions: [],
  subscriptionIntervalMinutes: Number(localStorage.getItem(SUBSCRIPTION_INTERVAL_STORAGE_KEY) || 360),
  searchResults: [],
  songLists: [],
  songListTags: [],
  songListHotTags: [],
  songListSorts: [],
  songListPage: 1,
  songListMode: 'list',
  songListKeyword: '',
  songListUid: '',
  activeSongList: null,
  songListSongs: [],
  songListDetailAllSongs: [],
  songListDetailPage: 1,
  songListDetailPageSize: 30,
  leaderBoards: [],
  leaderBoardPage: 1,
  leaderBoardPageSize: 12,
  activeLeaderBoard: null,
  leaderSongs: [],
  leaderPage: 1,
  activeView: 'search',
};

const $ = (id) => document.getElementById(id);

const toast = (message) => {
  const el = $('toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { el.hidden = true; }, 3200);
};

const formatSize = (bytes) => {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / Math.pow(1024, index)).toFixed(2)} ${units[index]}`;
};

const formatTime = (time) => {
  if (!time) return '从未';
  return new Date(time).toLocaleString();
};

const formatInterval = (minutes) => {
  const value = Number(minutes || 0);
  if (value >= 1440 && value % 1440 === 0) return `${value / 1440} 天`;
  if (value >= 60 && value % 60 === 0) return `${value / 60} 小时`;
  return `${value || 0} 分钟`;
};

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, ch => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}[ch]));

const api = async (path, options = {}) => {
  const headers = {
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    ...(state.adminPassword ? { 'x-admin-password': state.adminPassword } : {}),
    ...(options.headers || {}),
  };
  const response = await fetch(path, { ...options, headers });
  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { success: response.ok, error: text }; }
  if (!response.ok || data.success === false) throw new Error(data.error || data.message || response.statusText);
  return data;
};

const getOptions = () => ({
  embedCover: $('opt-cover').checked,
  embedLyric: $('opt-lyric').checked,
  writeTags: $('opt-tags').checked,
  verifyMetadata: $('opt-verify').checked,
});

const qualityLabel = (quality) => QUALITY_LABELS[quality] || quality || '';

const loadConfig = async () => {
  const data = await api('/api/config');
  state.config = data;
  state.platforms = data.platforms || [];
  $('server-status').textContent = data.adminRequired ? '需要管理员密码' : '本地模式';
  const neteaseStatus = $('netease-cookie-status');
  if (neteaseStatus) {
    const enabled = !!data.netease?.cookieResolverEnabled;
    neteaseStatus.textContent = enabled ? '网易云 Cookie 已启用' : '网易云 Cookie 未启用';
    neteaseStatus.className = `badge ${enabled ? 'ok' : 'warn'}`;
  }
  renderPlatforms();
};

const renderPlatforms = () => {
  const renderSelect = (id, predicate = () => true) => {
    const select = $(id);
    if (!select) return;
    const platforms = state.platforms.filter(predicate);
    select.innerHTML = platforms.length
      ? platforms.map(p => `<option value="${p.id}">${escapeHtml(p.name)} (${p.id})</option>`).join('')
      : '<option value="">无可用平台</option>';
  };
  renderSelect('search-source');
  renderSelect('songlist-source', p => p.songListSupported);
  renderSelect('leaderboard-source', p => p.leaderboardSupported);
};

const activateView = (view) => {
  state.activeView = view;
  document.querySelectorAll('.menu-item').forEach(item => {
    item.classList.toggle('active', item.dataset.view === view);
  });
  document.querySelectorAll('.view-section').forEach(section => {
    section.classList.toggle('active', section.id === `view-${view}`);
  });

  if (view === 'songlist' && !state.songLists.length && !state.songListTags.length) {
    loadSongListTags()
      .then(() => loadSongLists(1))
      .catch(error => toast(error.message));
  }
  if (view === 'leaderboard' && !state.leaderBoards.length) {
    loadLeaderBoards().catch(error => toast(error.message));
  }
  if (view === 'tasks') {
    loadTasks().catch(error => toast(error.message));
  }
  if (view === 'files') {
    loadFiles().catch(error => toast(error.message));
  }
  if (view === 'sources') {
    loadSources().catch(error => toast(error.message));
  }
  if (view === 'subscriptions') {
    loadSubscriptions().catch(error => toast(error.message));
  }
};

const loadSources = async () => {
  state.sources = await api('/api/sources');
  renderSources();
  await loadConfig().catch(() => {});
};

const renderSources = () => {
  const el = $('sources-list');
  if (!state.sources.length) {
    el.innerHTML = '<div class="meta">暂无音源</div>';
    return;
  }
  el.innerHTML = state.sources.map(source => {
    const statusClass = source.status === 'success' ? 'ok' : (source.status === 'failed' ? 'fail' : 'warn');
    const platforms = (source.supportedSources || []).map(id => `<span class="badge">${escapeHtml(id)}</span>`).join('');
    const sourceId = encodeURIComponent(source.id);
    return `
      <div class="source-item">
        <div class="item-title">
          <span>${escapeHtml(source.name)}</span>
          <span class="badge ${statusClass}">${escapeHtml(source.status || 'disabled')}</span>
        </div>
        <div class="meta">v${escapeHtml(source.version)} · ${escapeHtml(source.author || 'unknown')}</div>
        <div class="badges">${platforms || '<span class="badge warn">无平台</span>'}</div>
        ${source.error ? `<div class="meta">${escapeHtml(source.error)}</div>` : ''}
        <div class="row-actions">
          <button type="button" onclick="toggleSource(decodeURIComponent('${sourceId}'), ${!source.enabled})">${source.enabled ? '禁用' : '启用'}</button>
          <button type="button" class="danger" onclick="deleteSource(decodeURIComponent('${sourceId}'))">删除</button>
        </div>
      </div>
    `;
  }).join('');
};

window.toggleSource = async (id, enabled) => {
  try {
    await api('/api/sources/toggle', {
      method: 'POST',
      body: JSON.stringify({ id, enabled, allowUnsafeVM: $('allow-unsafe-vm').checked }),
    });
    toast(enabled ? '已启用音源' : '已禁用音源');
    await loadSources();
  } catch (error) {
    toast(error.message);
  }
};

window.deleteSource = async (id) => {
  if (!confirm('删除该音源？')) return;
  try {
    await api('/api/sources/delete', { method: 'POST', body: JSON.stringify({ id }) });
    toast('已删除音源');
    await loadSources();
  } catch (error) {
    toast(error.message);
  }
};

const loadTasks = async () => {
  const data = await api('/api/download/tasks');
  state.tasks = data.tasks || [];
  renderTasks();
};

const statusName = (status) => ({
  waiting: '等待',
  resolving: '解析',
  downloading: '下载',
  metadata_fetching: '元数据',
  tagging: '写标签',
  verifying: '检查',
  finished: '完成',
  failed: '失败',
  stopped: '停止',
}[status] || status);

const renderTasks = () => {
  const el = $('tasks-list');
  if (!state.tasks.length) {
    el.innerHTML = '<div class="meta">暂无任务</div>';
    return;
  }
  el.innerHTML = state.tasks.map(task => {
    const statusClass = task.status === 'finished' ? 'ok' : (task.status === 'failed' ? 'fail' : (task.status === 'stopped' ? 'warn' : ''));
    const qualityText = task.requestedQuality && task.requestedQuality !== task.quality
      ? `${qualityLabel(task.requestedQuality)} -> ${qualityLabel(task.quality)}`
      : qualityLabel(task.quality);
    const errors = [
      ...(task.metadata?.metadataErrors || []),
      ...(task.metadata?.verifyErrors || []),
      ...(task.metadata?.verifyWarnings || []),
    ];
    return `
      <div class="task-item">
        <div class="item-title">
          <span>${escapeHtml(task.songInfo?.name || 'Unknown')}</span>
          <span class="badge ${statusClass}">${statusName(task.status)}</span>
        </div>
        <div class="meta">${escapeHtml(task.songInfo?.singer || '')} · ${escapeHtml(task.source)} · ${escapeHtml(qualityText)}</div>
        <div class="progress"><span style="width:${Math.max(0, Math.min(100, task.progress || 0))}%"></span></div>
        <div class="meta">${task.progress || 0}% · ${formatSize(task.received)} / ${formatSize(task.total)} · ${formatSize(task.speed)}/s</div>
        <div class="badges">
          <span class="badge ${task.metadata?.coverFetched ? 'ok' : 'warn'}">封面</span>
          <span class="badge ${task.metadata?.lyricFetched ? 'ok' : 'warn'}">歌词</span>
          <span class="badge ${task.metadata?.tagsWritten ? 'ok' : 'warn'}">标签</span>
          <span class="badge ${task.metadata?.verified ? 'ok' : 'warn'}">检查</span>
        </div>
        ${task.error ? `<div class="meta">${escapeHtml(task.error)}</div>` : ''}
        ${errors.length ? `<div class="meta">${escapeHtml(errors.join('；'))}</div>` : ''}
        <div class="row-actions">
          ${['waiting', 'resolving', 'downloading', 'metadata_fetching', 'tagging', 'verifying'].includes(task.status) ? `<button type="button" onclick="stopTask('${task.id}')">停止</button>` : ''}
          ${['failed', 'stopped'].includes(task.status) ? `<button type="button" onclick="retryTask('${task.id}')">重试</button>` : ''}
          ${task.attempts?.length ? `<button type="button" onclick="showAttempts('${task.id}')">attempts</button>` : ''}
        </div>
      </div>
    `;
  }).join('');
};

window.stopTask = async (id) => {
  try {
    await api(`/api/download/tasks/${encodeURIComponent(id)}/stop`, { method: 'POST' });
    await loadTasks();
  } catch (error) {
    toast(error.message);
  }
};

window.retryTask = async (id) => {
  try {
    await api(`/api/download/tasks/${encodeURIComponent(id)}/retry`, { method: 'POST' });
    toast('已创建重试任务');
    await loadTasks();
  } catch (error) {
    toast(error.message);
  }
};

window.showAttempts = (id) => {
  const task = state.tasks.find(item => item.id === id);
  alert(JSON.stringify(task?.attempts || [], null, 2));
};

const pinSongSource = (songInfo, source) => {
  if (!source) return songInfo;
  return {
    ...(songInfo || {}),
    source,
    meta: songInfo?.meta && typeof songInfo.meta === 'object'
      ? { ...songInfo.meta, source }
      : songInfo?.meta,
  };
};

const createDownloadTask = async (songInfo, silent = false, source = '') => {
  const pinnedSongInfo = pinSongSource(songInfo, source);
  const data = await api('/api/download/tasks', {
    method: 'POST',
    body: JSON.stringify({
      songInfo: pinnedSongInfo,
      source: source || pinnedSongInfo?.source,
      options: getOptions(),
    }),
  });
  if (!silent) {
    toast('已创建下载任务');
    await loadTasks();
  }
  return data.task;
};

const createDownloadTasks = async (songs, source = '') => {
  if (!songs.length) return toast('暂无可下载歌曲');
  let created = 0;
  for (const song of songs) {
    await createDownloadTask(song, true, source);
    created += 1;
  }
  toast(`已创建 ${created} 个下载任务`);
  await loadTasks();
};

const subscriptionTypeName = (type) => ({
  songList: '歌单',
  leaderboard: '榜单',
}[type] || type);

const subscriptionStatusName = (status) => ({
  idle: '空闲',
  running: '更新中',
  success: '成功',
  failed: '失败',
}[status] || status || '空闲');

const subscriptionPayload = (type, item, targetId, source) => ({
  type,
  source,
  targetId,
  title: itemText(item, ['name', 'title', 'diss_name'], type === 'songList' ? '歌单' : '榜单'),
  intervalMinutes: state.subscriptionIntervalMinutes,
  options: getOptions(),
});

const loadSubscriptions = async () => {
  const data = await api('/api/subscriptions');
  state.subscriptions = data.subscriptions || [];
  renderSubscriptions();
};

const renderSubscriptions = () => {
  const el = $('subscriptions-list');
  if (!state.subscriptions.length) {
    el.innerHTML = '<div class="meta">暂无订阅</div>';
    return;
  }
  el.innerHTML = state.subscriptions.map(sub => {
    const statusClass = sub.lastRunStatus === 'success' ? 'ok' : (sub.lastRunStatus === 'failed' ? 'fail' : (sub.lastRunStatus === 'running' ? 'warn' : ''));
    return `
      <div class="subscription-item">
        <div class="item-title">
          <span>${escapeHtml(sub.title || sub.targetId)}</span>
          <span class="badge ${statusClass}">${subscriptionStatusName(sub.lastRunStatus)}</span>
        </div>
        <div class="meta">${subscriptionTypeName(sub.type)} · ${escapeHtml(sub.source)} · 每 ${formatInterval(sub.intervalMinutes)} · ${qualityLabel(sub.quality)}</div>
        <div class="badges">
          <span class="badge ${sub.enabled ? 'ok' : 'warn'}">${sub.enabled ? '启用' : '暂停'}</span>
          <span class="badge">发现 ${Number(sub.lastFoundCount || 0)}</span>
          <span class="badge">新增 ${Number(sub.lastCreatedCount || 0)}</span>
          <span class="badge">已记录 ${sub.downloadedKeys?.length || 0}</span>
        </div>
        <div class="meta">上次检查：${formatTime(sub.lastCheckedAt)} · 上次更新：${formatTime(sub.lastUpdatedAt)}</div>
        ${sub.lastError ? `<div class="meta">${escapeHtml(sub.lastError)}</div>` : ''}
        <div class="row-actions">
          <button type="button" onclick="runSubscription('${sub.id}')">立即更新</button>
          <button type="button" onclick="toggleSubscription('${sub.id}', ${!sub.enabled})">${sub.enabled ? '暂停' : '启用'}</button>
          <button type="button" class="danger" onclick="deleteSubscription('${sub.id}')">删除</button>
        </div>
      </div>
    `;
  }).join('');
};

const createSubscription = async (payload) => {
  const data = await api('/api/subscriptions', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  toast('订阅已添加，开始更新');
  await loadSubscriptions();
  await loadTasks().catch(() => {});
  return data.subscription;
};

window.runSubscription = async (id) => {
  try {
    await api(`/api/subscriptions/${encodeURIComponent(id)}/run`, { method: 'POST' });
    toast('已开始更新订阅');
    await loadSubscriptions();
    await loadTasks().catch(() => {});
  } catch (error) {
    toast(error.message);
  }
};

window.toggleSubscription = async (id, enabled) => {
  try {
    await api(`/api/subscriptions/${encodeURIComponent(id)}/toggle`, {
      method: 'POST',
      body: JSON.stringify({ enabled }),
    });
    toast(enabled ? '订阅已启用' : '订阅已暂停');
    await loadSubscriptions();
  } catch (error) {
    toast(error.message);
  }
};

window.deleteSubscription = async (id) => {
  if (!confirm('删除该订阅？')) return;
  try {
    await api(`/api/subscriptions/${encodeURIComponent(id)}`, { method: 'DELETE' });
    toast('订阅已删除');
    await loadSubscriptions();
  } catch (error) {
    toast(error.message);
  }
};

const getSongName = (song) => song?.name || song?.songName || song?.title || song?.meta?.name || '';
const getSongSinger = (song) => song?.singer || song?.artist || song?.author || song?.meta?.singer || '';
const getSongAlbum = (song) => song?.albumName || song?.album || song?.meta?.albumName || '';
const getSongInterval = (song) => song?.interval || song?.duration || song?.meta?.interval || '';

const renderSongTable = (targetId, songs, prefix, downloadHandler) => {
  const el = $(targetId);
  if (!songs.length) {
    el.innerHTML = '<div class="meta">暂无歌曲</div>';
    return;
  }
  el.innerHTML = `
    <table>
      <thead><tr><th>歌曲</th><th>歌手</th><th>专辑</th><th>时长</th><th>音质</th><th></th></tr></thead>
      <tbody>
        ${songs.map((song, index) => {
          return `
            <tr>
              <td>${escapeHtml(getSongName(song))}</td>
              <td>${escapeHtml(getSongSinger(song))}</td>
              <td>${escapeHtml(getSongAlbum(song))}</td>
              <td>${escapeHtml(getSongInterval(song))}</td>
              <td>${qualityLabel('best')}</td>
              <td><button class="primary" type="button" onclick="${downloadHandler}(${index})">下载</button></td>
            </tr>
          `;
        }).join('')}
      </tbody>
    </table>
  `;
};

const itemText = (item, keys, fallback = '') => {
  for (const key of keys) {
    const value = key.split('.').reduce((obj, part) => obj?.[part], item);
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return fallback;
};

const songListId = (item) => itemText(item, ['id', 'dissid', 'tid', 'playlistId', 'listId'], '');
const boardId = (item) => itemText(item, ['bangid', 'id', 'boardId', 'topId'], '');
const itemImage = (item) => itemText(item, ['img', 'pic', 'cover', 'coverImgUrl', 'logo'], '');

const renderCompactItems = (targetId, items, openHandler, emptyText) => {
  const el = $(targetId);
  if (!items.length) {
    el.innerHTML = `<div class="meta">${escapeHtml(emptyText)}</div>`;
    return;
  }
  el.innerHTML = items.map((item, index) => {
    const image = itemImage(item);
    const name = itemText(item, ['name', 'title', 'diss_name'], '未命名');
    const author = itemText(item, ['author', 'nickname', 'creator.nickname', 'userName'], '');
    const total = itemText(item, ['total', 'song_cnt', 'songCount', 'count'], '');
    const playCount = itemText(item, ['play_count', 'playCount', 'listen_num'], '');
    const desc = itemText(item, ['desc', 'intro', 'description'], '');
    return `
      <button class="compact-item" type="button" onclick="${openHandler}(${index})">
        ${image ? `<img src="${escapeHtml(image)}" alt="">` : '<span class="compact-cover"></span>'}
        <span>
          <strong>${escapeHtml(name)}</strong>
          <span class="meta">${escapeHtml([author, total ? `${total} 首` : '', playCount ? `${playCount} 播放` : ''].filter(Boolean).join(' · '))}</span>
          ${desc ? `<span class="meta clamp">${escapeHtml(desc)}</span>` : ''}
        </span>
      </button>
    `;
  }).join('');
};

const renderSearchResults = () => {
  const el = $('search-results');
  if (!state.searchResults.length) {
    el.innerHTML = '<div class="meta">暂无结果</div>';
    return;
  }
  el.innerHTML = `
    <table>
      <thead><tr><th>歌曲</th><th>歌手</th><th>专辑</th><th>时长</th><th>音质</th><th></th></tr></thead>
      <tbody>
        ${state.searchResults.map((song, index) => {
          return `
            <tr>
              <td>${escapeHtml(song.name)}</td>
              <td>${escapeHtml(song.singer)}</td>
              <td>${escapeHtml(song.albumName || song.album || '')}</td>
              <td>${escapeHtml(song.interval || '')}</td>
              <td>${qualityLabel('best')}</td>
              <td><button class="primary" type="button" onclick="downloadSearchResult(${index})">下载</button></td>
            </tr>
          `;
        }).join('')}
      </tbody>
    </table>
  `;
};

window.downloadSearchResult = async (index) => {
  const song = state.searchResults[index];
  try {
    await createDownloadTask(song);
  } catch (error) {
    toast(error.message);
  }
};

const renderSongListFilters = () => {
  const sortSelect = $('songlist-sort');
  const tagSelect = $('songlist-tag');
  sortSelect.innerHTML = (state.songListSorts.length ? state.songListSorts : [{ id: 'hot', name: '最热' }, { id: 'new', name: '最新' }])
    .map(item => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name || item.id)}</option>`)
    .join('');

  const hotTags = state.songListHotTags || [];
  const tagGroups = state.songListTags || [];
  const parts = ['<option value="">全部 / 推荐</option>'];
  if (hotTags.length) {
    parts.push(`<optgroup label="热门">${hotTags.map(item => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name || item.id)}</option>`).join('')}</optgroup>`);
  }
  for (const group of tagGroups) {
    const list = Array.isArray(group.list) ? group.list : [];
    if (!list.length) continue;
    parts.push(`<optgroup label="${escapeHtml(group.name || '分类')}">${list.map(item => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name || item.id)}</option>`).join('')}</optgroup>`);
  }
  tagSelect.innerHTML = parts.join('');
};

const loadSongListTags = async () => {
  const source = $('songlist-source').value;
  if (!source) {
    state.songListTags = [];
    state.songListHotTags = [];
    state.songListSorts = [];
    renderSongListFilters();
    return;
  }
  const data = await api(`/api/music/songList/tags?source=${encodeURIComponent(source)}`);
  state.songListTags = data.tags || [];
  state.songListHotTags = data.hotTag || data.hotTags || [];
  state.songListSorts = data.sortList || [];
  renderSongListFilters();
};

const renderSongLists = () => {
  renderCompactItems('songlist-results', state.songLists, 'openSongList', '暂无歌单');
  $('songlist-prev').disabled = state.songListPage <= 1;
  $('songlist-next').disabled = !state.songLists.length || (state.songListTotal > 0
    ? state.songListPage * (state.songListLimit || state.songLists.length || 1) >= state.songListTotal
    : false);
};

const loadSongLists = async (page = state.songListPage) => {
  const source = $('songlist-source').value;
  if (!source) return toast('暂无支持歌单的平台');
  let data;
  if (state.songListMode === 'search') {
    if (!state.songListKeyword) return toast('请输入歌单名称');
    data = await api(`/api/music/songList/search?source=${encodeURIComponent(source)}&text=${encodeURIComponent(state.songListKeyword)}&page=${page}`);
  } else if (state.songListMode === 'user') {
    if (!state.songListUid) return toast('请输入用户 UID');
    data = await api(`/api/music/songList/userPlaylist?source=${encodeURIComponent(source)}&uid=${encodeURIComponent(state.songListUid)}&page=${page}`);
  } else {
    const sortId = $('songlist-sort').value || 'hot';
    const tagId = $('songlist-tag').value || '';
    data = await api(`/api/music/songList/list?source=${encodeURIComponent(source)}&sortId=${encodeURIComponent(sortId)}&tagId=${encodeURIComponent(tagId)}&page=${page}`);
  }
  state.songListPage = Number(data.page || page || 1);
  state.songListTotal = Number(data.total || 0);
  state.songListLimit = Number(data.limit || data.list?.length || 0);
  state.songLists = data.list || [];
  state.activeSongList = null;
  state.songListSongs = [];
  state.songListDetailAllSongs = [];
  state.songListDetailPage = 1;
  renderSongLists();
  renderSongListDetail();
};

const getSongListDetailPageCount = () => {
  return Math.max(1, Math.ceil(state.songListDetailAllSongs.length / state.songListDetailPageSize));
};

const renderSongListDetail = () => {
  const title = state.activeSongList
    ? itemText(state.songListDetail || state.activeSongList, ['name', 'title'], '歌曲')
    : '歌曲';
  const pageCount = getSongListDetailPageCount();
  state.songListDetailPage = Math.max(1, Math.min(state.songListDetailPage, pageCount));
  const start = (state.songListDetailPage - 1) * state.songListDetailPageSize;
  state.songListSongs = state.songListDetailAllSongs.slice(start, start + state.songListDetailPageSize);
  $('songlist-detail-title').textContent = title;
  renderSongTable('songlist-detail', state.songListSongs, 'songlist', 'downloadSongListSong');
  $('songlist-detail-page').textContent = `${state.songListDetailPage} / ${pageCount}`;
  $('songlist-detail-prev').disabled = state.songListDetailPage <= 1;
  $('songlist-detail-next').disabled = state.songListDetailPage >= pageCount || !state.activeSongList;
  $('songlist-detail-download-page').disabled = !state.songListSongs.length;
  $('songlist-subscribe').disabled = !state.activeSongList;
};

const loadSongListDetail = async () => {
  const item = state.activeSongList;
  const id = songListId(item);
  const source = $('songlist-source').value || item?.source;
  if (!source || !id) return toast('歌单缺少可用 ID');
  const data = await api(`/api/music/songList/detail?source=${encodeURIComponent(source)}&id=${encodeURIComponent(id)}&page=1`);
  state.songListDetail = data.info || item;
  state.songListDetailAllSongs = (data.list || []).map(song => pinSongSource(song, source));
  state.songListDetailPage = 1;
  state.songListDetailTotal = Number(data.total || 0);
  state.songListDetailLimit = Number(data.limit || data.list?.length || 0);
  renderSongListDetail();
};

const changeSongListDetailPage = (delta) => {
  state.songListDetailPage = Math.max(1, Math.min(getSongListDetailPageCount(), state.songListDetailPage + delta));
  renderSongListDetail();
};

window.openSongList = async (index) => {
  try {
    state.activeSongList = state.songLists[index];
    state.songListDetailPage = 1;
    await loadSongListDetail();
  } catch (error) {
    toast(error.message);
  }
};

window.downloadSongListSong = async (index) => {
  const song = state.songListSongs[index];
  const source = $('songlist-source').value || state.activeSongList?.source;
  try {
    await createDownloadTask(song, false, source);
  } catch (error) {
    toast(error.message);
  }
};

window.subscribeActiveSongList = async () => {
  const item = state.activeSongList;
  const targetId = songListId(item);
  const source = $('songlist-source').value || item?.source;
  if (!item || !source || !targetId) return toast('请先打开一个歌单');
  try {
    await createSubscription(subscriptionPayload('songList', item, targetId, source));
  } catch (error) {
    toast(error.message);
  }
};

const getLeaderBoardPageCount = () => {
  return Math.max(1, Math.ceil(state.leaderBoards.length / state.leaderBoardPageSize));
};

const getLeaderBoardPageItems = () => {
  const pageCount = getLeaderBoardPageCount();
  state.leaderBoardPage = Math.max(1, Math.min(state.leaderBoardPage, pageCount));
  const start = (state.leaderBoardPage - 1) * state.leaderBoardPageSize;
  return state.leaderBoards.slice(start, start + state.leaderBoardPageSize);
};

const renderLeaderBoards = () => {
  const pageCount = getLeaderBoardPageCount();
  const pageItems = getLeaderBoardPageItems();
  renderCompactItems('leaderboard-boards', pageItems, 'openLeaderBoard', '暂无榜单');
  $('leaderboard-board-page').textContent = `${state.leaderBoardPage} / ${pageCount}`;
  $('leaderboard-board-prev').disabled = state.leaderBoardPage <= 1;
  $('leaderboard-board-next').disabled = state.leaderBoardPage >= pageCount || !state.leaderBoards.length;
};

const loadLeaderBoards = async () => {
  const source = $('leaderboard-source').value;
  if (!source) return toast('暂无支持榜单的平台');
  const data = await api(`/api/music/leaderboard/boards?source=${encodeURIComponent(source)}`);
  state.leaderBoards = data.list || [];
  state.leaderBoardPage = 1;
  state.activeLeaderBoard = null;
  state.leaderSongs = [];
  renderLeaderBoards();
  renderLeaderSongs();
};

const renderLeaderSongs = () => {
  const title = state.activeLeaderBoard ? itemText(state.activeLeaderBoard, ['name', 'title'], '歌曲') : '歌曲';
  $('leaderboard-title').textContent = title;
  renderSongTable('leaderboard-songs', state.leaderSongs, 'leaderboard', 'downloadLeaderSong');
  $('leaderboard-song-page').textContent = `第 ${state.leaderPage} 页`;
  $('leaderboard-prev').disabled = state.leaderPage <= 1;
  $('leaderboard-next').disabled = state.leaderTotal > 0
    ? state.leaderPage * (state.leaderLimit || state.leaderSongs.length || 1) >= state.leaderTotal
    : !state.activeLeaderBoard;
  $('leaderboard-download-page').disabled = !state.leaderSongs.length;
  $('leaderboard-subscribe').disabled = !state.activeLeaderBoard;
};

const loadLeaderSongs = async (page = state.leaderPage) => {
  const item = state.activeLeaderBoard;
  const id = boardId(item);
  const source = $('leaderboard-source').value || item?.source;
  if (!source || !id) return toast('榜单缺少可用 ID');
  const data = await api(`/api/music/leaderboard/list?source=${encodeURIComponent(source)}&bangid=${encodeURIComponent(id)}&page=${page}`);
  state.leaderSongs = (data.list || []).map(song => pinSongSource(song, source));
  state.leaderPage = Number(data.page || page || 1);
  state.leaderTotal = Number(data.total || 0);
  state.leaderLimit = Number(data.limit || data.list?.length || 0);
  renderLeaderSongs();
};

window.openLeaderBoard = async (index) => {
  try {
    state.activeLeaderBoard = getLeaderBoardPageItems()[index];
    state.leaderPage = 1;
    await loadLeaderSongs(1);
  } catch (error) {
    toast(error.message);
  }
};

window.downloadLeaderSong = async (index) => {
  const song = state.leaderSongs[index];
  const source = $('leaderboard-source').value || state.activeLeaderBoard?.source;
  try {
    await createDownloadTask(song, false, source);
  } catch (error) {
    toast(error.message);
  }
};

window.subscribeActiveLeaderBoard = async () => {
  const item = state.activeLeaderBoard;
  const targetId = boardId(item);
  const source = $('leaderboard-source').value || item?.source;
  if (!item || !source || !targetId) return toast('请先打开一个榜单');
  try {
    await createSubscription(subscriptionPayload('leaderboard', item, targetId, source));
  } catch (error) {
    toast(error.message);
  }
};

const loadFiles = async () => {
  const data = await api('/api/download/files');
  state.files = data.files || [];
  renderFiles();
};

const renderFiles = () => {
  const el = $('files-list');
  if (!state.files.length) {
    el.innerHTML = '<div class="meta">暂无文件</div>';
    return;
  }
  el.innerHTML = `
    <table>
      <thead><tr><th>歌曲</th><th>文件</th><th>音质</th><th>大小</th><th>元数据</th><th></th></tr></thead>
      <tbody>
        ${state.files.map(file => {
          const tagClass = file.tagStatus === 'ok' ? 'ok' : (file.tagStatus === 'error' ? 'fail' : 'warn');
          return `
            <tr>
              <td>${escapeHtml(file.name)}<div class="meta">${escapeHtml(file.singer)} · ${escapeHtml(file.album || '')}</div></td>
              <td>${escapeHtml(file.filename)}<div class="meta">${escapeHtml(file.duration || '')} · ${escapeHtml(file.bitrate || '')}kbps</div></td>
              <td>${escapeHtml(file.quality)}</td>
              <td>${formatSize(file.size)}</td>
              <td>
                <span class="badge ${tagClass}">${escapeHtml(file.tagStatus)}</span>
                <span class="badge ${file.hasCover ? 'ok' : 'warn'}">封面</span>
                <span class="badge ${file.hasEmbedLyric ? 'ok' : 'warn'}">歌词</span>
              </td>
              <td>
                <div class="row-actions">
                  <button type="button" onclick="downloadFile('${encodeURIComponent(file.filename)}')">下载</button>
                  <button type="button" onclick="verifyFile('${encodeURIComponent(file.filename)}')">检查</button>
                  <button type="button" onclick="rewriteFile('${encodeURIComponent(file.filename)}')">重写</button>
                  <button type="button" class="danger" onclick="deleteFile('${encodeURIComponent(file.filename)}')">删除</button>
                </div>
              </td>
            </tr>
          `;
        }).join('')}
      </tbody>
    </table>
  `;
};

window.downloadFile = (filename) => {
  window.location.href = `/api/download/files/${filename}`;
};

window.verifyFile = async (filename) => {
  try {
    await api(`/api/download/files/${filename}/verify`, { method: 'POST' });
    toast('检查完成');
    await loadFiles();
  } catch (error) {
    toast(error.message);
  }
};

window.rewriteFile = async (filename) => {
  try {
    await api(`/api/download/files/${filename}/rewrite-tags`, { method: 'POST' });
    toast('重写完成');
    await loadFiles();
  } catch (error) {
    toast(error.message);
  }
};

window.deleteFile = async (filename) => {
  if (!confirm('删除该文件？')) return;
  try {
    await api(`/api/download/files/${filename}`, { method: 'DELETE' });
    toast('已删除文件');
    await loadFiles();
  } catch (error) {
    toast(error.message);
  }
};

const bindEvents = () => {
  $('admin-password').value = state.adminPassword;
  $('subscription-interval').value = String(state.subscriptionIntervalMinutes || 360);
  $('subscription-interval').addEventListener('change', () => {
    state.subscriptionIntervalMinutes = Number($('subscription-interval').value || 360);
    localStorage.setItem(SUBSCRIPTION_INTERVAL_STORAGE_KEY, String(state.subscriptionIntervalMinutes));
  });

  $('admin-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    state.adminPassword = $('admin-password').value;
    try {
      await api('/api/admin/verify', { method: 'POST', body: JSON.stringify({ password: state.adminPassword }) });
      localStorage.setItem(ADMIN_STORAGE_KEY, state.adminPassword);
      toast('验证成功');
      await loadSources();
    } catch (error) {
      toast(error.message);
    }
  });

  $('source-url-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await api('/api/sources/import', {
        method: 'POST',
        body: JSON.stringify({ url: $('source-url').value, allowUnsafeVM: $('allow-unsafe-vm').checked }),
      });
      $('source-url').value = '';
      toast('导入完成');
      await loadSources();
    } catch (error) {
      toast(error.message);
    }
  });

  $('source-file-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const file = $('source-file').files[0];
    if (!file) return toast('请选择文件');
    try {
      const content = await file.text();
      await api('/api/sources/upload', {
        method: 'POST',
        body: JSON.stringify({ filename: file.name, content, allowUnsafeVM: $('allow-unsafe-vm').checked }),
      });
      $('source-file').value = '';
      toast('上传完成');
      await loadSources();
    } catch (error) {
      toast(error.message);
    }
  });

  $('search-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const source = $('search-source').value;
    const keyword = $('search-keyword').value.trim();
    if (!keyword) return;
    try {
      const data = await api(`/api/music/search?source=${encodeURIComponent(source)}&keyword=${encodeURIComponent(keyword)}&page=1&limit=30`);
      state.searchResults = data.list || [];
      renderSearchResults();
    } catch (error) {
      toast(error.message);
    }
  });

  $('songlist-source').addEventListener('change', async () => {
    try {
      state.songListMode = 'list';
      state.songListPage = 1;
      state.songListDetailPage = 1;
      await loadSongListTags();
      await loadSongLists(1);
    } catch (error) {
      toast(error.message);
    }
  });

  $('songlist-search-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      state.songListMode = 'search';
      state.songListKeyword = $('songlist-keyword').value.trim();
      state.songListPage = 1;
      await loadSongLists(1);
    } catch (error) {
      toast(error.message);
    }
  });

  $('songlist-load').addEventListener('click', async () => {
    try {
      state.songListMode = 'list';
      state.songListPage = 1;
      await loadSongLists(1);
    } catch (error) {
      toast(error.message);
    }
  });

  $('songlist-tags-refresh').addEventListener('click', async () => {
    try {
      await loadSongListTags();
      toast('标签已刷新');
    } catch (error) {
      toast(error.message);
    }
  });

  $('songlist-user').addEventListener('click', async () => {
    try {
      state.songListMode = 'user';
      state.songListUid = $('songlist-uid').value.trim();
      state.songListPage = 1;
      await loadSongLists(1);
    } catch (error) {
      toast(error.message);
    }
  });

  $('songlist-prev').addEventListener('click', () => loadSongLists(Math.max(1, state.songListPage - 1)).catch(error => toast(error.message)));
  $('songlist-next').addEventListener('click', () => loadSongLists(state.songListPage + 1).catch(error => toast(error.message)));
  $('songlist-subscribe').addEventListener('click', () => subscribeActiveSongList());
  $('songlist-detail-prev').addEventListener('click', () => changeSongListDetailPage(-1));
  $('songlist-detail-next').addEventListener('click', () => changeSongListDetailPage(1));
  $('songlist-detail-download-page').addEventListener('click', () => {
    const source = $('songlist-source').value || state.activeSongList?.source;
    createDownloadTasks(state.songListSongs, source).catch(error => toast(error.message));
  });

  $('leaderboard-source').addEventListener('change', () => loadLeaderBoards().catch(error => toast(error.message)));
  $('leaderboard-refresh').addEventListener('click', () => loadLeaderBoards().catch(error => toast(error.message)));
  $('leaderboard-board-prev').addEventListener('click', () => {
    state.leaderBoardPage = Math.max(1, state.leaderBoardPage - 1);
    renderLeaderBoards();
  });
  $('leaderboard-board-next').addEventListener('click', () => {
    state.leaderBoardPage = Math.min(getLeaderBoardPageCount(), state.leaderBoardPage + 1);
    renderLeaderBoards();
  });
  $('leaderboard-prev').addEventListener('click', () => loadLeaderSongs(Math.max(1, state.leaderPage - 1)).catch(error => toast(error.message)));
  $('leaderboard-next').addEventListener('click', () => loadLeaderSongs(state.leaderPage + 1).catch(error => toast(error.message)));
  $('leaderboard-subscribe').addEventListener('click', () => subscribeActiveLeaderBoard());
  $('leaderboard-download-page').addEventListener('click', () => {
    const source = $('leaderboard-source').value || state.activeLeaderBoard?.source;
    createDownloadTasks(state.leaderSongs, source).catch(error => toast(error.message));
  });

  document.querySelectorAll('.menu-item').forEach(item => {
    item.addEventListener('click', () => {
      activateView(item.dataset.view);
    });
  });

  $('refresh-sources').addEventListener('click', () => loadSources().catch(error => toast(error.message)));
  $('refresh-subscriptions').addEventListener('click', () => loadSubscriptions().catch(error => toast(error.message)));
  $('refresh-tasks').addEventListener('click', () => loadTasks().catch(error => toast(error.message)));
  $('refresh-files').addEventListener('click', () => loadFiles().catch(error => toast(error.message)));
};

const init = async () => {
  bindEvents();
  await loadConfig().catch(error => toast(error.message));
  await loadSources().catch(error => toast(error.message));
  renderSongListFilters();
  renderSongLists();
  renderSongListDetail();
  renderLeaderBoards();
  renderLeaderSongs();
  await loadSubscriptions().catch(error => toast(error.message));
  await loadTasks().catch(error => toast(error.message));
  await loadFiles().catch(error => toast(error.message));
  setInterval(() => loadTasks().catch(() => {}), 1500);
  setInterval(() => loadFiles().catch(() => {}), 8000);
  setInterval(() => {
    if (state.activeView === 'subscriptions') loadSubscriptions().catch(() => {});
  }, 5000);
};

void init();
