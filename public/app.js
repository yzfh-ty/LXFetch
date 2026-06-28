const ADMIN_STORAGE_KEY = 'lxfetch_admin';
const LEGACY_ADMIN_STORAGE_KEY = 'lxdownload_admin';

const state = {
  adminPassword: localStorage.getItem(ADMIN_STORAGE_KEY) || localStorage.getItem(LEGACY_ADMIN_STORAGE_KEY) || '',
  config: null,
  platforms: [],
  sources: [],
  tasks: [],
  files: [],
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
  songListDetailPage: 1,
  leaderBoards: [],
  activeLeaderBoard: null,
  leaderSongs: [],
  leaderPage: 1,
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

const qualityRank = (quality) => {
  const value = String(quality || '').toLowerCase();
  if (value.includes('master')) return 90;
  if (value.includes('flac24') || value.includes('24bit') || value.includes('hires')) return 80;
  if (value.includes('flac') || value.includes('ape') || value.includes('wav')) return 70;
  const bitrate = Number((value.match(/\d+/) || [0])[0]);
  if (bitrate) return bitrate;
  return 0;
};

const qualityList = (song) => {
  const detected = [];
  if (song._types) detected.push(...Object.keys(song._types));
  if (Array.isArray(song.types)) {
    for (const item of song.types) if (item.type && !detected.includes(item.type)) detected.push(item.type);
  }
  const values = detected.length
    ? detected.sort((a, b) => qualityRank(b) - qualityRank(a))
    : ['flac24bit', 'flac', '320k', '128k'];
  for (const fallback of ['flac24bit', 'flac', '320k', '128k']) {
    if (!values.includes(fallback)) values.push(fallback);
  }
  return values;
};

const loadConfig = async () => {
  const data = await api('/api/config');
  state.config = data;
  state.platforms = data.platforms || [];
  $('server-status').textContent = data.adminRequired ? '需要管理员密码' : '本地模式';
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
          <button type="button" onclick="toggleSource('${escapeHtml(source.id)}', ${!source.enabled})">${source.enabled ? '禁用' : '启用'}</button>
          <button type="button" class="danger" onclick="deleteSource('${escapeHtml(source.id)}')">删除</button>
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
        <div class="meta">${escapeHtml(task.songInfo?.singer || '')} · ${escapeHtml(task.source)} · ${escapeHtml(task.quality)}</div>
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

const createDownloadTask = async (songInfo, quality, silent = false) => {
  const data = await api('/api/download/tasks', {
    method: 'POST',
    body: JSON.stringify({ songInfo, quality, options: getOptions() }),
  });
  if (!silent) {
    toast('已创建下载任务');
    await loadTasks();
  }
  return data.task;
};

const createDownloadTasks = async (songs) => {
  if (!songs.length) return toast('暂无可下载歌曲');
  let created = 0;
  for (const song of songs) {
    await createDownloadTask(song, qualityList(song)[0] || '320k', true);
    created += 1;
  }
  toast(`已创建 ${created} 个下载任务`);
  await loadTasks();
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
          const qualities = qualityList(song);
          return `
            <tr>
              <td>${escapeHtml(getSongName(song))}</td>
              <td>${escapeHtml(getSongSinger(song))}</td>
              <td>${escapeHtml(getSongAlbum(song))}</td>
              <td>${escapeHtml(getSongInterval(song))}</td>
              <td>
                <select id="${prefix}-quality-${index}">
                  ${qualities.map(q => `<option value="${q}">${escapeHtml(q)}</option>`).join('')}
                </select>
              </td>
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
          const qualities = qualityList(song);
          return `
            <tr>
              <td>${escapeHtml(song.name)}</td>
              <td>${escapeHtml(song.singer)}</td>
              <td>${escapeHtml(song.albumName || song.album || '')}</td>
              <td>${escapeHtml(song.interval || '')}</td>
              <td>
                <select id="quality-${index}">
                  ${qualities.map(q => `<option value="${q}">${escapeHtml(q)}</option>`).join('')}
                </select>
              </td>
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
  const quality = $(`quality-${index}`).value;
  try {
    await createDownloadTask(song, quality);
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
  renderSongLists();
  renderSongListDetail();
};

const renderSongListDetail = () => {
  const title = state.activeSongList
    ? itemText(state.songListDetail || state.activeSongList, ['name', 'title'], '歌曲')
    : '歌曲';
  $('songlist-detail-title').textContent = title;
  renderSongTable('songlist-detail', state.songListSongs, 'songlist', 'downloadSongListSong');
  $('songlist-detail-prev').disabled = state.songListDetailPage <= 1;
  $('songlist-detail-next').disabled = state.songListDetailTotal > 0
    ? state.songListDetailPage * (state.songListDetailLimit || state.songListSongs.length || 1) >= state.songListDetailTotal
    : !state.activeSongList;
  $('songlist-detail-download-page').disabled = !state.songListSongs.length;
};

const loadSongListDetail = async (page = state.songListDetailPage) => {
  const item = state.activeSongList;
  const id = songListId(item);
  const source = item?.source || $('songlist-source').value;
  if (!source || !id) return toast('歌单缺少可用 ID');
  const data = await api(`/api/music/songList/detail?source=${encodeURIComponent(source)}&id=${encodeURIComponent(id)}&page=${page}`);
  state.songListDetail = data.info || item;
  state.songListSongs = data.list || [];
  state.songListDetailPage = Number(data.page || page || 1);
  state.songListDetailTotal = Number(data.total || 0);
  state.songListDetailLimit = Number(data.limit || data.list?.length || 0);
  renderSongListDetail();
};

window.openSongList = async (index) => {
  try {
    state.activeSongList = state.songLists[index];
    state.songListDetailPage = 1;
    await loadSongListDetail(1);
  } catch (error) {
    toast(error.message);
  }
};

window.downloadSongListSong = async (index) => {
  const song = state.songListSongs[index];
  const quality = $(`songlist-quality-${index}`).value;
  try {
    await createDownloadTask(song, quality);
  } catch (error) {
    toast(error.message);
  }
};

const renderLeaderBoards = () => {
  renderCompactItems('leaderboard-boards', state.leaderBoards, 'openLeaderBoard', '暂无榜单');
};

const loadLeaderBoards = async () => {
  const source = $('leaderboard-source').value;
  if (!source) return toast('暂无支持榜单的平台');
  const data = await api(`/api/music/leaderboard/boards?source=${encodeURIComponent(source)}`);
  state.leaderBoards = data.list || [];
  state.activeLeaderBoard = null;
  state.leaderSongs = [];
  renderLeaderBoards();
  renderLeaderSongs();
};

const renderLeaderSongs = () => {
  const title = state.activeLeaderBoard ? itemText(state.activeLeaderBoard, ['name', 'title'], '歌曲') : '歌曲';
  $('leaderboard-title').textContent = title;
  renderSongTable('leaderboard-songs', state.leaderSongs, 'leaderboard', 'downloadLeaderSong');
  $('leaderboard-prev').disabled = state.leaderPage <= 1;
  $('leaderboard-next').disabled = state.leaderTotal > 0
    ? state.leaderPage * (state.leaderLimit || state.leaderSongs.length || 1) >= state.leaderTotal
    : !state.activeLeaderBoard;
  $('leaderboard-download-page').disabled = !state.leaderSongs.length;
};

const loadLeaderSongs = async (page = state.leaderPage) => {
  const item = state.activeLeaderBoard;
  const id = boardId(item);
  const source = item?.source || $('leaderboard-source').value;
  if (!source || !id) return toast('榜单缺少可用 ID');
  const data = await api(`/api/music/leaderboard/list?source=${encodeURIComponent(source)}&bangid=${encodeURIComponent(id)}&page=${page}`);
  state.leaderSongs = data.list || [];
  state.leaderPage = Number(data.page || page || 1);
  state.leaderTotal = Number(data.total || 0);
  state.leaderLimit = Number(data.limit || data.list?.length || 0);
  renderLeaderSongs();
};

window.openLeaderBoard = async (index) => {
  try {
    state.activeLeaderBoard = state.leaderBoards[index];
    state.leaderPage = 1;
    await loadLeaderSongs(1);
  } catch (error) {
    toast(error.message);
  }
};

window.downloadLeaderSong = async (index) => {
  const song = state.leaderSongs[index];
  const quality = $(`leaderboard-quality-${index}`).value;
  try {
    await createDownloadTask(song, quality);
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
  $('songlist-detail-prev').addEventListener('click', () => loadSongListDetail(Math.max(1, state.songListDetailPage - 1)).catch(error => toast(error.message)));
  $('songlist-detail-next').addEventListener('click', () => loadSongListDetail(state.songListDetailPage + 1).catch(error => toast(error.message)));
  $('songlist-detail-download-page').addEventListener('click', () => createDownloadTasks(state.songListSongs).catch(error => toast(error.message)));

  $('leaderboard-source').addEventListener('change', () => loadLeaderBoards().catch(error => toast(error.message)));
  $('leaderboard-refresh').addEventListener('click', () => loadLeaderBoards().catch(error => toast(error.message)));
  $('leaderboard-prev').addEventListener('click', () => loadLeaderSongs(Math.max(1, state.leaderPage - 1)).catch(error => toast(error.message)));
  $('leaderboard-next').addEventListener('click', () => loadLeaderSongs(state.leaderPage + 1).catch(error => toast(error.message)));
  $('leaderboard-download-page').addEventListener('click', () => createDownloadTasks(state.leaderSongs).catch(error => toast(error.message)));

  $('json-download').addEventListener('click', async () => {
    try {
      const songInfo = JSON.parse($('songinfo-json').value);
      await createDownloadTask(songInfo, $('json-quality').value);
    } catch (error) {
      toast(error.message);
    }
  });

  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(item => item.classList.remove('active'));
      document.querySelectorAll('.tab-body').forEach(item => item.classList.remove('active'));
      tab.classList.add('active');
      $(`tab-${tab.dataset.tab}`).classList.add('active');
      if (tab.dataset.tab === 'songlist' && !state.songLists.length && !state.songListTags.length) {
        loadSongListTags()
          .then(() => loadSongLists(1))
          .catch(error => toast(error.message));
      }
      if (tab.dataset.tab === 'leaderboard' && !state.leaderBoards.length) {
        loadLeaderBoards().catch(error => toast(error.message));
      }
    });
  });

  $('refresh-sources').addEventListener('click', () => loadSources().catch(error => toast(error.message)));
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
  await loadTasks().catch(error => toast(error.message));
  await loadFiles().catch(error => toast(error.message));
  setInterval(() => loadTasks().catch(() => {}), 1500);
  setInterval(() => loadFiles().catch(() => {}), 8000);
};

void init();
