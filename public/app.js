const ADMIN_STORAGE_KEY = 'lxfetch_admin';
const LEGACY_ADMIN_STORAGE_KEY = 'lxdownload_admin';
const SUBSCRIPTION_INTERVAL_STORAGE_KEY = 'lxfetch_subscription_interval';
const TASK_ACTIVE_STATUSES = ['waiting', 'resolving', 'downloading', 'metadata_fetching', 'tagging', 'verifying'];

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
  taskStats: null,
  taskStatusFilter: 'all',
  tasksPage: 1,
  tasksPageSize: 12,
  files: [],
  filesPage: 1,
  filesPageSize: 20,
  subscriptions: [],
  subscriptionsPage: 1,
  subscriptionsPageSize: 8,
  localMatchState: null,
  subscriptionIntervalMinutes: Number(localStorage.getItem(SUBSCRIPTION_INTERVAL_STORAGE_KEY) || 360),
  searchResults: [],
  songLists: [],
  songListTags: [],
  songListHotTags: [],
  songListSorts: [],
  songListPage: 1,
  songListResultsPage: 1,
  songListResultsPageSize: 8,
  songListMode: 'list',
  songListKeyword: '',
  songListUid: '',
  activeSongList: null,
  songListSongs: [],
  songListDetailAllSongs: [],
  songListDetailPage: 1,
  songListDetailPageSize: 24,
  leaderBoards: [],
  leaderBoardPage: 1,
  leaderBoardPageSize: 10,
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

const getPageCount = (total, pageSize) => Math.max(1, Math.ceil(Number(total || 0) / Math.max(1, Number(pageSize || 1))));

const clampPage = (page, total, pageSize) => Math.max(1, Math.min(Number(page || 1), getPageCount(total, pageSize)));

const getPagedItems = (items, pageKey, pageSizeKey) => {
  const list = Array.isArray(items) ? items : [];
  state[pageSizeKey] = Math.max(1, Number(state[pageSizeKey] || 1));
  state[pageKey] = clampPage(state[pageKey], list.length, state[pageSizeKey]);
  const start = (state[pageKey] - 1) * state[pageSizeKey];
  const end = Math.min(start + state[pageSizeKey], list.length);
  return {
    items: list.slice(start, end),
    page: state[pageKey],
    pageCount: getPageCount(list.length, state[pageSizeKey]),
    pageSize: state[pageSizeKey],
    startIndex: list.length ? start + 1 : 0,
    endIndex: end,
    total: list.length,
  };
};

const PAGE_SIZE_OPTIONS = {
  tasks: [8, 12, 20, 50],
  subscriptions: [5, 8, 12, 20],
  files: [10, 20, 40, 80],
};

const PAGE_STATE = {
  tasks: ['tasksPage', 'tasksPageSize'],
  subscriptions: ['subscriptionsPage', 'subscriptionsPageSize'],
  files: ['filesPage', 'filesPageSize'],
};

const renderPagedList = (kind) => {
  if (kind === 'tasks') renderTasks();
  if (kind === 'subscriptions') renderSubscriptions();
  if (kind === 'files') renderFiles();
};

const clearPager = (targetId) => {
  const el = $(targetId);
  if (el) el.innerHTML = '';
};

const renderPager = (targetId, kind, pageData, unit = '条') => {
  const el = $(targetId);
  if (!el) return;
  const options = PAGE_SIZE_OPTIONS[kind] || [];
  const canPrev = pageData.page > 1;
  const canNext = pageData.page < pageData.pageCount;
  const rangeText = pageData.total
    ? `${pageData.startIndex}-${pageData.endIndex} / ${pageData.total}`
    : `0 / 0`;
  el.innerHTML = `
    <span class="page-info">显示 ${rangeText} ${unit} · 第 ${pageData.page} / ${pageData.pageCount} 页</span>
    <span class="pager-controls">
      ${options.length ? `
        <label class="page-size-field">
          <span>每页</span>
          <select onchange="setListPageSize('${kind}', this.value)">
            ${options.map(size => `<option value="${size}" ${Number(pageData.pageSize) === size ? 'selected' : ''}>${size}</option>`).join('')}
          </select>
        </label>
      ` : ''}
      <button type="button" onclick="changeListPage('${kind}', -1)" ${canPrev ? '' : 'disabled'}>上一页</button>
      <button type="button" onclick="changeListPage('${kind}', 1)" ${canNext ? '' : 'disabled'}>下一页</button>
    </span>
  `;
};

window.changeListPage = (kind, delta) => {
  const keys = PAGE_STATE[kind];
  if (!keys) return;
  const [pageKey] = keys;
  state[pageKey] = Math.max(1, Number(state[pageKey] || 1) + Number(delta || 0));
  renderPagedList(kind);
};

window.setListPageSize = (kind, value) => {
  const keys = PAGE_STATE[kind];
  if (!keys) return;
  const [pageKey, pageSizeKey] = keys;
  state[pageKey] = 1;
  state[pageSizeKey] = Math.max(1, Number(value || state[pageSizeKey] || 1));
  renderPagedList(kind);
};

const displayValue = (value) => {
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.join(' -> ');
  return value == null || value === '' ? '-' : String(value);
};

const renderConfigTable = (rows) => `
  <table>
    <tbody>
      ${rows.map(([name, value]) => `
        <tr>
          <td>${escapeHtml(name)}</td>
          <td>${escapeHtml(displayValue(value))}</td>
        </tr>
      `).join('')}
    </tbody>
  </table>
`;

const renderConfigSummary = () => {
  const el = $('config-summary');
  if (!el) return;
  const cfg = state.config;
  if (!cfg) {
    el.innerHTML = '<div class="meta">暂无配置</div>';
    return;
  }
  const download = cfg.download || {};
  const subscription = cfg.subscription || {};
  const navidrome = cfg.navidrome || {};
  const localMatch = cfg.localMatch || {};
  const netease = cfg.netease || {};
  const platformRows = (cfg.platforms || []).map(platform => ([
    `${platform.name} (${platform.id})`,
    [
      platform.resolverEnabled ? '解析' : '',
      platform.songListSupported ? '歌单' : '',
      platform.leaderboardSupported ? '榜单' : '',
      platform.userPlaylistSupported ? '用户歌单' : '',
    ].filter(Boolean).join(' / ') || '-',
  ]));

  el.innerHTML = `
    <div class="stack">
      <div>
        <h3>下载</h3>
        ${renderConfigTable([
          ['并发任务', download.maxConcurrent],
          ['限速 bytes/s', download.throttleBytesPerSecond],
          ['下载重试', download.maxRetries],
          ['重试延迟 ms', download.retryDelayMs],
          ['写入封面', download.embedCover],
          ['写入歌词', download.embedLyric],
          ['写入标签', download.writeTags],
          ['元数据检查', download.verifyMetadata],
          ['元数据缓存', download.cacheMetadata],
          ['缓存过期天数', download.metadataCacheMaxAgeDays],
          ['缓存大小上限', formatSize(download.metadataCacheMaxBytes || 0)],
          ['跳过已存在', download.skipExisting],
          ['低音质升级', download.upgradeExisting],
        ])}
      </div>
      <div>
        <h3>订阅</h3>
        ${renderConfigTable([
          ['每轮入队上限', subscription.maxTasksPerRun],
          ['入队间隔 ms', subscription.taskCreateDelayMs],
        ])}
      </div>
      <div>
        <h3>Navidrome</h3>
        ${renderConfigTable([
          ['集成启用', navidrome.enabled],
          ['歌单同步', navidrome.playlistSyncEnabled],
          ['歌单目录', navidrome.playlistDir || '-'],
          ['路径模式', navidrome.playlistPathMode || '-'],
          ['同步间隔分钟', navidrome.playlistExportIntervalMinutes],
          ['导出后扫描', navidrome.scanAfterExport],
          ['服务地址已配置', navidrome.baseUrlConfigured],
          ['用户已配置', navidrome.usernameConfigured],
          ['密码已配置', navidrome.passwordConfigured],
        ])}
      </div>
      <div>
        <h3>本地曲库匹配</h3>
        ${renderConfigTable([
          ['启用', localMatch.enabled],
          ['监听目录', localMatch.watchEnabled],
          ['监听防抖 ms', localMatch.watchDebounceMs],
          ['生成未匹配歌单', localMatch.includeUnmatchedPlaylist],
          ['未匹配歌单名', localMatch.unmatchedPlaylistName],
          ['匹配模式', localMatch.matchMode],
          ['时长容差秒', localMatch.durationToleranceSeconds],
        ])}
      </div>
      <div>
        <h3>音源</h3>
        ${renderConfigTable([
          ['网易云 Cookie', netease.cookieResolverEnabled],
          ['音质顺序', cfg.qualityFallbackOrder || []],
        ])}
      </div>
      <div>
        <h3>平台</h3>
        ${renderConfigTable(platformRows.length ? platformRows : [['平台', '-']])}
      </div>
    </div>
  `;
};

const loadMetadataCacheStatus = async () => {
  const el = $('metadata-cache-status');
  if (!el) return;
  const data = await api('/api/cache/metadata');
  el.textContent = `缓存 ${formatSize(data.totalBytes || 0)}`;
};

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
  await loadMetadataCacheStatus().catch(() => {});
  renderConfigSummary();
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
  if (view === 'config') {
    loadConfig().catch(error => toast(error.message));
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
  el.innerHTML = state.sources.map((source, index) => {
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
          <button type="button" onclick="moveSource(decodeURIComponent('${sourceId}'), -1)" ${index <= 0 ? 'disabled' : ''}>上移</button>
          <button type="button" onclick="moveSource(decodeURIComponent('${sourceId}'), 1)" ${index >= state.sources.length - 1 ? 'disabled' : ''}>下移</button>
          <button type="button" onclick="toggleSource(decodeURIComponent('${sourceId}'), ${!source.enabled})">${source.enabled ? '禁用' : '启用'}</button>
          <button type="button" class="danger" onclick="deleteSource(decodeURIComponent('${sourceId}'))">删除</button>
        </div>
      </div>
    `;
  }).join('');
};

window.moveSource = async (id, direction) => {
  const index = state.sources.findIndex(source => source.id === id);
  const nextIndex = index + direction;
  if (index < 0 || nextIndex < 0 || nextIndex >= state.sources.length) return;
  const ordered = state.sources.map(source => source.id);
  [ordered[index], ordered[nextIndex]] = [ordered[nextIndex], ordered[index]];
  try {
    await api('/api/sources/reorder', {
      method: 'POST',
      body: JSON.stringify({ ids: ordered }),
    });
    toast('音源顺序已更新');
    await loadSources();
  } catch (error) {
    toast(error.message);
  }
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
  state.taskStats = data.stats || null;
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

const getFilteredTasks = () => {
  if (state.taskStatusFilter === 'all') return state.tasks;
  if (state.taskStatusFilter === 'active') {
    return state.tasks.filter(task => TASK_ACTIVE_STATUSES.includes(task.status));
  }
  return state.tasks.filter(task => task.status === state.taskStatusFilter);
};

const errorCategoryName = (category) => ({
  resolve: '解析',
  quality: '音质',
  network: '网络',
  remote: '远端',
  filesystem: '文件',
  metadata: '元数据',
  tagging: '标签',
  verification: '检查',
  duplicate: '已存在',
  unknown: '未知',
}[category] || category);

const renderTasks = () => {
  const filteredTasks = getFilteredTasks();
  const pageData = getPagedItems(filteredTasks, 'tasksPage', 'tasksPageSize');
  const summary = $('tasks-summary');
  if (summary) {
    const stats = state.taskStats || {};
    const byStatus = stats.byStatus || {};
    const pageRange = pageData.total ? `${pageData.startIndex}-${pageData.endIndex}` : '0';
    const parts = [
      `总数 ${Number(stats.total || 0)}`,
      `当前 ${filteredTasks.length}`,
      `显示 ${pageRange}`,
      `活动 ${Number(stats.active || 0)}`,
      `速度 ${formatSize(stats.speed || 0)}/s`,
      `等待 ${Number(byStatus.waiting || 0)}`,
      `下载 ${Number(byStatus.downloading || 0)}`,
      `失败 ${Number(byStatus.failed || 0)}`,
    ];
    summary.textContent = parts.join(' · ');
  }
  const el = $('tasks-list');
  if (!state.tasks.length) {
    el.innerHTML = '<div class="meta">暂无任务</div>';
    clearPager('tasks-pager');
    return;
  }
  if (!filteredTasks.length) {
    el.innerHTML = '<div class="meta">当前筛选下暂无任务</div>';
    clearPager('tasks-pager');
    return;
  }
  renderPager('tasks-pager', 'tasks', pageData, '个任务');
  el.innerHTML = pageData.items.map(task => {
    const statusClass = task.status === 'finished' ? 'ok' : (task.status === 'failed' ? 'fail' : (task.status === 'stopped' ? 'warn' : ''));
    const qualityText = task.requestedQuality && task.requestedQuality !== task.quality
      ? `${qualityLabel(task.requestedQuality)} -> ${qualityLabel(task.quality)}`
      : qualityLabel(task.quality);
    const retryText = task.maxRetries ? `重试 ${task.retryCount || 0}/${task.maxRetries}` : '';
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
          ${task.errorCategory ? `<span class="badge warn">${escapeHtml(errorCategoryName(task.errorCategory))}</span>` : ''}
          ${task.retryCount ? `<span class="badge warn">${escapeHtml(retryText)}</span>` : ''}
        </div>
        ${task.error ? `<div class="meta">${escapeHtml(task.error)}</div>` : ''}
        ${errors.length ? `<div class="meta">${escapeHtml(errors.join('；'))}</div>` : ''}
        <div class="row-actions">
          ${['waiting', 'resolving', 'downloading'].includes(task.status) ? `<button type="button" onclick="stopTask('${task.id}')">停止</button>` : ''}
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
    toast('已重新加入队列');
    await loadTasks();
  } catch (error) {
    toast(error.message);
  }
};

const clearTasks = async (statuses, label) => {
  try {
    const result = await api('/api/download/tasks/clear', {
      method: 'POST',
      body: JSON.stringify({ statuses }),
    });
    await loadTasks();
    toast(`${label} ${result.removed || 0} 个任务`);
  } catch (error) {
    toast(error.message);
  }
};

const retryFailedTasks = async () => {
  try {
    const result = await api('/api/download/tasks/retry-failed', { method: 'POST' });
    await loadTasks();
    const skippedText = result.skipped ? `，跳过 ${result.skipped} 个` : '';
    toast(`已重新加入队列 ${result.retried || result.count || 0} 个失败任务${skippedText}`);
  } catch (error) {
    toast(error.message);
  }
};

const stopActiveTasks = async () => {
  try {
    const result = await api('/api/download/tasks/stop-active', { method: 'POST' });
    await loadTasks();
    toast(`已停止 ${result.count || 0} 个任务`);
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
  cancelled: '已取消',
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
  if (state.config?.localMatch?.enabled) {
    try {
      const localMatch = await api('/api/subscriptions/local-match');
      state.localMatchState = localMatch.state || null;
    } catch {
      state.localMatchState = null;
    }
  } else {
    state.localMatchState = null;
  }
  renderSubscriptions();
};

const renderSubscriptions = () => {
  const el = $('subscriptions-list');
  const navidromeEnabled = !!(state.config?.navidrome?.enabled && state.config?.navidrome?.playlistSyncEnabled);
  const localMatchEnabled = !!(navidromeEnabled && state.config?.localMatch?.enabled);
  const syncAllButton = $('sync-navidrome-playlists');
  const syncLocalButton = $('sync-local-match');
  const cancelAllButton = $('cancel-subscription-task-creation');
  const hasRunningSubscription = state.subscriptions.some(sub => sub.running || sub.lastRunStatus === 'running');
  if (syncAllButton) syncAllButton.hidden = !navidromeEnabled;
  if (syncLocalButton) syncLocalButton.hidden = !localMatchEnabled;
  if (cancelAllButton) cancelAllButton.hidden = !hasRunningSubscription;
  if (!state.subscriptions.length) {
    el.innerHTML = '<div class="meta">暂无订阅</div>';
    clearPager('subscriptions-pager');
    return;
  }
  const pageData = getPagedItems(state.subscriptions, 'subscriptionsPage', 'subscriptionsPageSize');
  const priority = state.localMatchState?.priority || [];
  const priorityIndex = new Map(priority.map((id, index) => [id, index + 1]));
  const localSummary = localMatchEnabled ? `
    <div class="subscription-item">
      <div class="item-title">
        <span>本地曲库匹配</span>
        <span class="badge ${state.localMatchState?.lastStatus === 'failed' ? 'fail' : (state.localMatchState?.lastStatus === 'running' ? 'warn' : 'ok')}">${escapeHtml(state.localMatchState?.lastStatus || 'idle')}</span>
      </div>
      <div class="badges">
        <span class="badge">扫描 ${Number(state.localMatchState?.lastTrackCount || 0)}</span>
        <span class="badge">已匹配 ${Number(state.localMatchState?.lastMatchedCount || 0)}</span>
        <span class="badge">未匹配 ${Number(state.localMatchState?.lastUnmatchedCount || 0)}</span>
        <span class="badge">监听 ${state.localMatchState?.watchEnabled ? '开启' : '关闭'}</span>
      </div>
      <div class="meta">上次匹配：${formatTime(state.localMatchState?.lastMatchedAt)} · 上次扫描：${formatTime(state.localMatchState?.lastScannedAt)}</div>
      ${state.localMatchState?.lastError ? `<div class="meta">${escapeHtml(state.localMatchState.lastError)}</div>` : ''}
    </div>
  ` : '';
  renderPager('subscriptions-pager', 'subscriptions', pageData, '个订阅');
  el.innerHTML = localSummary + pageData.items.map(sub => {
    const statusClass = sub.lastRunStatus === 'success' ? 'ok' : (sub.lastRunStatus === 'failed' ? 'fail' : (sub.lastRunStatus === 'running' || sub.lastRunStatus === 'cancelled' ? 'warn' : ''));
    const order = priorityIndex.get(sub.id);
    const phaseText = sub.runPhase === 'creating' ? '创建任务中' : (sub.runPhase === 'scanning' ? '扫描中' : '');
    return `
      <div class="subscription-item">
        <div class="item-title">
          <span>${escapeHtml(sub.title || sub.targetId)}</span>
          <span class="badge ${statusClass}">${subscriptionStatusName(sub.lastRunStatus)}</span>
        </div>
        <div class="meta">${subscriptionTypeName(sub.type)} · ${escapeHtml(sub.source)} · 每 ${formatInterval(sub.intervalMinutes)} · ${qualityLabel(sub.quality)}</div>
        <div class="badges">
          <span class="badge ${sub.enabled ? 'ok' : 'warn'}">${sub.enabled ? '启用' : '暂停'}</span>
          ${phaseText ? `<span class="badge warn">${phaseText}</span>` : ''}
          ${sub.cancelRequested ? '<span class="badge warn">取消中</span>' : ''}
          ${localMatchEnabled ? `<span class="badge">优先级 ${order || '-'}</span>` : ''}
          <span class="badge">发现 ${Number(sub.lastFoundCount || 0)}</span>
          <span class="badge">新增 ${Number(sub.lastCreatedCount || 0)}</span>
          <span class="badge">跳过 ${Number(sub.lastSkippedCount || 0)}</span>
          ${sub.lastInvalidCount ? `<span class="badge warn">无效 ${Number(sub.lastInvalidCount || 0)}</span>` : ''}
          <span class="badge">已记录 ${sub.downloadedKeys?.length || 0}</span>
        </div>
        ${navidromeEnabled ? `
          <div class="badges">
            <span class="badge ${sub.lastPlaylistError ? 'fail' : (sub.lastPlaylistSyncedAt ? 'ok' : '')}">Navidrome ${sub.lastPlaylistSyncedAt ? '已同步' : '未同步'}</span>
            <span class="badge">歌单 ${escapeHtml(sub.lastPlaylistDisplayName || sub.title || sub.targetId)}</span>
            <span class="badge">已入歌单 ${Number(sub.lastPlaylistDownloadedCount || 0)}</span>
            <span class="badge">未下载 ${Number(sub.lastPlaylistMissingCount || 0)}</span>
          </div>
          <div class="meta">智能歌单文件：${escapeHtml(sub.lastPlaylistFile || '-')} · 上次同步：${formatTime(sub.lastPlaylistSyncedAt)}</div>
          ${sub.lastPlaylistError ? `<div class="meta">${escapeHtml(sub.lastPlaylistError)}</div>` : ''}
        ` : ''}
        <div class="meta">上次检查：${formatTime(sub.lastCheckedAt)} · 上次更新：${formatTime(sub.lastUpdatedAt)}</div>
        ${sub.lastError ? `<div class="meta">${escapeHtml(sub.lastError)}</div>` : ''}
        <div class="row-actions">
          <button type="button" onclick="runSubscription('${sub.id}')">立即更新</button>
          ${sub.running || sub.lastRunStatus === 'running' ? `<button type="button" onclick="cancelSubscriptionTaskCreation('${sub.id}')">取消创建剩余任务</button>` : ''}
          ${navidromeEnabled ? `<button type="button" onclick="${localMatchEnabled ? 'syncLocalLibraryMatch()' : `syncNavidromePlaylist('${sub.id}')`}">${localMatchEnabled ? '匹配本地' : '同步歌单'}</button>` : ''}
          ${localMatchEnabled ? `<button type="button" onclick="moveLocalMatchPriority('${sub.id}', -1)">上移</button><button type="button" onclick="moveLocalMatchPriority('${sub.id}', 1)">下移</button>` : ''}
          <button type="button" onclick="toggleSubscription('${sub.id}', ${!sub.enabled})">${sub.enabled ? '暂停' : '启用'}</button>
          <button type="button" onclick="resetSubscription('${sub.id}')">重置记录</button>
          <button type="button" class="danger" onclick="deleteSubscription('${sub.id}')">删除</button>
        </div>
      </div>
    `;
  }).join('');
};

window.syncNavidromePlaylist = async (id) => {
  try {
    const data = await api(`/api/subscriptions/${encodeURIComponent(id)}/navidrome-sync`, { method: 'POST' });
    const result = data.result || {};
    toast(`已同步 ${Number(result.downloaded || 0)} 首，未下载 ${Number(result.missing || 0)} 首`);
    await loadSubscriptions();
  } catch (error) {
    toast(error.message);
  }
};

const syncAllNavidromePlaylists = async () => {
  try {
    const data = await api('/api/subscriptions/navidrome-sync', { method: 'POST' });
    const results = data.result?.results || data.results || [];
    const downloaded = results.reduce((sum, item) => sum + Number(item.downloaded || 0), 0);
    const missing = results.reduce((sum, item) => sum + Number(item.missing || 0), 0);
    toast(`已同步 ${results.length} 个歌单，已下载 ${downloaded} 首，未下载 ${missing} 首`);
    await loadSubscriptions();
  } catch (error) {
    toast(error.message);
  }
};

const syncLocalLibraryMatch = async () => {
  try {
    const data = await api('/api/subscriptions/local-match', { method: 'POST' });
    const result = data.result || {};
    toast(`本地匹配完成：扫描 ${Number(result.scanned || 0)} 首，匹配 ${Number(result.matched || 0)} 首，未匹配 ${Number(result.unmatched || 0)} 首`);
    await loadSubscriptions();
  } catch (error) {
    toast(error.message);
  }
};

window.moveLocalMatchPriority = async (id, direction) => {
  const subscriptionIds = state.subscriptions.map(sub => sub.id);
  const existing = state.localMatchState?.priority || [];
  const priority = [];
  for (const item of existing) if (subscriptionIds.includes(item) && !priority.includes(item)) priority.push(item);
  for (const item of subscriptionIds) if (!priority.includes(item)) priority.push(item);
  const index = priority.indexOf(id);
  if (index < 0) return;
  const nextIndex = Math.max(0, Math.min(priority.length - 1, index + direction));
  if (nextIndex === index) return;
  const [item] = priority.splice(index, 1);
  priority.splice(nextIndex, 0, item);
  try {
    const data = await api('/api/subscriptions/local-match/priority', {
      method: 'POST',
      body: JSON.stringify({ priority }),
    });
    state.localMatchState = data.state || state.localMatchState;
    toast('匹配优先级已更新');
    await loadSubscriptions();
  } catch (error) {
    toast(error.message);
  }
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

window.cancelSubscriptionTaskCreation = async (id) => {
  try {
    await api(`/api/subscriptions/${encodeURIComponent(id)}/cancel-task-creation`, { method: 'POST' });
    toast('已请求取消剩余下载任务创建');
    await loadSubscriptions();
  } catch (error) {
    toast(error.message);
  }
};

const cancelAllSubscriptionTaskCreation = async () => {
  try {
    const data = await api('/api/subscriptions/cancel-task-creation', { method: 'POST' });
    toast(`已请求取消 ${Number(data.result?.requested || 0)} 个订阅的剩余任务创建`);
    await loadSubscriptions();
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

window.resetSubscription = async (id) => {
  if (!confirm('清空该订阅的已记录歌曲？')) return;
  try {
    await api(`/api/subscriptions/${encodeURIComponent(id)}/reset`, { method: 'POST' });
    toast('订阅记录已重置');
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

const getSongListResultPageData = () => getPagedItems(state.songLists, 'songListResultsPage', 'songListResultsPageSize');

const getSongListResultPageItems = () => getSongListResultPageData().items;

const clearActiveSongListDetail = () => {
  state.activeSongList = null;
  state.songListSongs = [];
  state.songListDetailAllSongs = [];
  state.songListDetailPage = 1;
  renderSongListDetail();
};

const hasNextSongListRemotePage = () => {
  if (!state.songLists.length) return false;
  return state.songListTotal > 0
    ? state.songListPage * (state.songListLimit || state.songLists.length || 1) < state.songListTotal
    : true;
};

const renderSongLists = () => {
  const pageData = getSongListResultPageData();
  renderCompactItems('songlist-results', pageData.items, 'openSongList', '暂无歌单');
  $('songlist-page').textContent = state.songLists.length
    ? `接口页 ${state.songListPage} · ${pageData.page} / ${pageData.pageCount}`
    : '1 / 1';
  $('songlist-prev').disabled = state.songListPage <= 1 && pageData.page <= 1;
  $('songlist-next').disabled = !state.songLists.length || (pageData.page >= pageData.pageCount && !hasNextSongListRemotePage());
};

const changeSongListResultsPage = (delta) => {
  const pageData = getSongListResultPageData();
  if (delta < 0) {
    if (pageData.page > 1) {
      state.songListResultsPage -= 1;
      renderSongLists();
      clearActiveSongListDetail();
      return;
    }
    loadSongLists(Math.max(1, state.songListPage - 1), 'last').catch(error => toast(error.message));
    return;
  }
  if (pageData.page < pageData.pageCount) {
    state.songListResultsPage += 1;
    renderSongLists();
    clearActiveSongListDetail();
    return;
  }
  loadSongLists(state.songListPage + 1).catch(error => toast(error.message));
};

const loadSongLists = async (page = state.songListPage, resultPage = 1) => {
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
  state.songListResultsPage = resultPage === 'last'
    ? getPageCount(state.songLists.length, state.songListResultsPageSize)
    : 1;
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
    state.activeSongList = getSongListResultPageItems()[index];
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
    clearPager('files-pager');
    return;
  }
  const pageData = getPagedItems(state.files, 'filesPage', 'filesPageSize');
  renderPager('files-pager', 'files', pageData, '个文件');
  el.innerHTML = `
    <table>
      <thead><tr><th>歌曲</th><th>文件</th><th>音质</th><th>大小</th><th>元数据</th><th></th></tr></thead>
      <tbody>
        ${pageData.items.map(file => {
          const tagClass = file.tagStatus === 'ok' ? 'ok' : (file.tagStatus === 'error' ? 'fail' : 'warn');
          const actualQuality = file.actualQualityLabel || file.actualQuality || '';
          return `
            <tr>
              <td>${escapeHtml(file.name)}<div class="meta">${escapeHtml(file.singer)} · ${escapeHtml(file.album || '')}</div></td>
              <td>${escapeHtml(file.filename)}<div class="meta">${escapeHtml(file.duration || '')} · ${escapeHtml(file.bitrate || '')}kbps</div></td>
              <td>${escapeHtml(qualityLabel(file.quality))}<div class="meta">${escapeHtml(actualQuality || '-')}</div></td>
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

  $('songlist-prev').addEventListener('click', () => changeSongListResultsPage(-1));
  $('songlist-next').addEventListener('click', () => changeSongListResultsPage(1));
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
  $('cleanup-metadata-cache').addEventListener('click', async () => {
    try {
      const result = await api('/api/cache/metadata/cleanup', { method: 'POST', body: JSON.stringify({}) });
      await loadMetadataCacheStatus();
      toast(`已清理 ${result.deletedFiles || 0} 个缓存文件`);
    } catch (error) {
      toast(error.message);
    }
  });
  $('refresh-subscriptions').addEventListener('click', () => loadSubscriptions().catch(error => toast(error.message)));
  $('sync-local-match').addEventListener('click', () => syncLocalLibraryMatch());
  $('sync-navidrome-playlists').addEventListener('click', () => syncAllNavidromePlaylists());
  $('cancel-subscription-task-creation').addEventListener('click', () => cancelAllSubscriptionTaskCreation());
  $('refresh-tasks').addEventListener('click', () => loadTasks().catch(error => toast(error.message)));
  $('task-status-filter').addEventListener('change', event => {
    state.taskStatusFilter = event.target.value;
    state.tasksPage = 1;
    renderTasks();
  });
  $('retry-failed-tasks').addEventListener('click', () => retryFailedTasks());
  $('stop-active-tasks').addEventListener('click', () => stopActiveTasks());
  $('clear-finished-tasks').addEventListener('click', () => clearTasks(['finished'], '已清理完成'));
  $('clear-failed-tasks').addEventListener('click', () => clearTasks(['failed', 'stopped'], '已清理失败/停止'));
  $('refresh-files').addEventListener('click', () => loadFiles().catch(error => toast(error.message)));
  $('refresh-config').addEventListener('click', async () => {
    try {
      await loadConfig();
      toast('配置已刷新');
    } catch (error) {
      toast(error.message);
    }
  });
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
