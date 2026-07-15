const { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage } = require('electron');
const path  = require('path');
const fs    = require('fs');
const https = require('https');

const DATA_DIR    = __dirname;
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const TIMERS_FILE = path.join(app.getPath('userData'), 'timers.json');
const LOG_FILE    = path.join(app.getPath('userData'), 'logged.json');

function readJSON(file, def = {}) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return def; }
}
function writeJSON(file, data) {
  try { fs.writeFileSync(file, JSON.stringify(data, null, 2)); } catch (e) { console.error(e); }
}

function jiraReq(cfg, method, p, body) {
  return new Promise((resolve, reject) => {
    const tok     = Buffer.from(`${cfg.email}:${cfg.token}`).toString('base64');
    const payload = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: cfg.site,
      path:     `/rest/api/3${p}`,
      method,
      headers: {
        'Authorization': `Basic ${tok}`,
        'Accept':        'application/json',
        'Content-Type':  'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {})
      }
    };
    const req = https.request(opts, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 400) {
          reject(new Error(`Jira ${res.statusCode}: ${data}`));
        } else {
          try { resolve(JSON.parse(data)); } catch { resolve(data); }
        }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function getMyAccountId(cfg) {
  const d = await jiraReq(cfg, 'GET', '/myself');
  return d.accountId;
}

async function fetchTodayLoggedSeconds(cfg, issueKey, accountId) {
  try {
    const d = await jiraReq(cfg, 'GET', `/issue/${issueKey}/worklog?maxResults=100`);
    const worklogs = d.worklogs || [];
    // Use local date string in user's timezone for comparison
    const todayStr = new Date().toLocaleDateString('en-US', { year:'numeric', month:'short', day:'numeric' });
    const total = worklogs
      .filter(w => {
        const sameAuthor = w.author?.accountId === accountId;
        const logDate = new Date(w.started).toLocaleDateString('en-US', { year:'numeric', month:'short', day:'numeric' });
        return sameAuthor && logDate === todayStr;
      })
      .reduce((sum, w) => sum + (w.timeSpentSeconds || 0), 0);
    if (total > 0) console.log(`[worklog] ${issueKey}: ${total}s logged today`);
    return total;
  } catch (e) {
    console.error(`[worklog] failed for ${issueKey}:`, e.message);
    return 0;
  }
}

async function fetchIssues(cfg) {
  const jql = encodeURIComponent('assignee = currentUser() AND statusCategory != Done ORDER BY status ASC, updated DESC');
  const d = await jiraReq(cfg, 'GET', `/search/jql?jql=${jql}&fields=summary,status,issuetype,priority,project,timetracking&maxResults=50`);
  const issues = d.issues || [];

  const accountId = await getMyAccountId(cfg);
  const loggedArr = await Promise.all(issues.map(i => fetchTodayLoggedSeconds(cfg, i.key, accountId)));

  // Build a plain todayLogged map and attach to each issue as a plain number
  // (avoids any IPC serialisation quirks with mutated API response objects)
  const todayLogged = {};
  issues.forEach((issue, idx) => {
    todayLogged[issue.key] = loggedArr[idx];
  });

  console.log('[fetchIssues] todayLogged map:', JSON.stringify(todayLogged));

  // Return plain objects so structured-clone has nothing to trip over
  return issues.map(issue => ({
    key:    issue.key,
    webUrl: issue.webUrl,
    fields: issue.fields,
    todayLoggedSeconds: todayLogged[issue.key] || 0
  }));
}

async function postWorklog(cfg, issueKey, timeSpent, started, comment) {
  const body = { timeSpent, started };
  if (comment) body.comment = { type:'doc', version:1, content:[{ type:'paragraph', content:[{ type:'text', text:comment }] }] };
  return jiraReq(cfg, 'POST', `/issue/${issueKey}/worklog`, body);
}

let win, tray, syncTimer;

function createWindow() {
  const cfg = readJSON(CONFIG_FILE);
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;
  const W = 400, MARGIN = 16;

  const opts = {
    width: W,
    height: sh - MARGIN * 2,
    x: sw - W - MARGIN,
    y: MARGIN,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  };

  win = new BrowserWindow(opts);
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false });
  win.loadFile(cfg.site && cfg.email && cfg.token ? 'renderer.html' : 'setup.html');
}

function createTray() {
  const b64 = 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAX0lEQVQ4T2NkoBAwUqifgWoGHD9+/D8DAwMDIwMDA8P/IQMDBgYGRgYcgJGBgYGBAYdmkAEYDmBgYGBgIGQABgYGBkYSDAYGBkYGQgZgYGBgYCBkAAYGBgYGQgb8BwAejxMRbMXD2wAAAABJRU5ErkJggg==';
  tray = new Tray(nativeImage.createFromDataURL(`data:image/png;base64,${b64}`));
  tray.setToolTip('Task Tracker');
  const menu = Menu.buildFromTemplate([
    { label: 'Show / Hide', click: () => win.isVisible() ? win.hide() : win.show() },
    { label: 'Settings',    click: () => win.loadFile('setup.html') },
    { type: 'separator' },
    { label: 'Quit', click: () => { if (syncTimer) clearInterval(syncTimer); app.exit(0); } }
  ]);
  tray.setContextMenu(menu);
  tray.on('click', () => win.isVisible() ? win.hide() : win.show());
}

ipcMain.handle('get-config',       ()     => readJSON(CONFIG_FILE));
ipcMain.handle('save-config',      (_, c) => { writeJSON(CONFIG_FILE, c); win.loadFile('renderer.html'); startSync(); return true; });
ipcMain.handle('fetch-issues',     async () => { const c = readJSON(CONFIG_FILE); if (!c.site) throw new Error('Not configured'); return fetchIssues(c); });
ipcMain.handle('post-worklog',     async (_, a) => postWorklog(readJSON(CONFIG_FILE), a.issueKey, a.timeSpent, a.started, a.comment));
ipcMain.handle('load-timers',      ()     => readJSON(TIMERS_FILE, {}));
ipcMain.handle('save-timers',      (_, d) => { writeJSON(TIMERS_FILE, d); return true; });
ipcMain.handle('get-today-logged', ()     => { const d = readJSON(LOG_FILE, {}); return d[new Date().toDateString()] || 0; });
ipcMain.handle('add-today-logged', (_, s) => { const d = readJSON(LOG_FILE, {}), k = new Date().toDateString(); d[k] = (d[k]||0)+s; writeJSON(LOG_FILE,d); return true; });

let prevLoggedSeconds = {}; // { [issueKey]: seconds } — tracks last known Jira-logged seconds

function startSync() {
  if (syncTimer) clearInterval(syncTimer);
  syncTimer = setInterval(async () => {
    try {
      const cfg = readJSON(CONFIG_FILE);
      if (!cfg.site) return;
      const issues = await fetchIssues(cfg);

      // Detect tickets where Jira time increased while a local timer was running
      const timers = readJSON(TIMERS_FILE, {});
      const jiraLogged = []; // keys where Jira gained new time
      issues.forEach(issue => {
        const key  = issue.key;
        const prev = prevLoggedSeconds[key] || 0;
        const curr = issue._todayLoggedSeconds || 0;
        if (curr > prev && timers[key]?.startedAt) {
          jiraLogged.push(key);
        }
        prevLoggedSeconds[key] = curr;
      });

      if (win && !win.isDestroyed()) {
        win.webContents.send('issues-update', issues);
        if (jiraLogged.length) win.webContents.send('jira-logged-detected', jiraLogged);
      }
    } catch (e) { console.error('sync error', e.message); }
  }, 30000);
}

app.whenReady().then(() => { createWindow(); createTray(); startSync(); });
app.on('window-all-closed', () => {});
