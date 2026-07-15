const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('api', {
  getConfig:      ()   => ipcRenderer.invoke('get-config'),
  saveConfig:     (c)  => ipcRenderer.invoke('save-config', c),
  fetchIssues:    ()   => ipcRenderer.invoke('fetch-issues'),
  postWorklog:    (a)  => ipcRenderer.invoke('post-worklog', a),
  loadTimers:     ()   => ipcRenderer.invoke('load-timers'),
  saveTimers:     (d)  => ipcRenderer.invoke('save-timers', d),
  getTodayLogged: ()   => ipcRenderer.invoke('get-today-logged'),
  addTodayLogged: (s)  => ipcRenderer.invoke('add-today-logged', s),
  onIssuesUpdate:       (fn) => ipcRenderer.on('issues-update',        (_, issues) => fn(issues)),
  onJiraLoggedDetected: (fn) => ipcRenderer.on('jira-logged-detected', (_, keys)   => fn(keys))
});
