import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  loginMicrosoft: () => ipcRenderer.invoke('login-microsoft'),
  saveUserSettings: (settings: any) => ipcRenderer.invoke('save-user-settings', settings),
  loadUserSettings: () => ipcRenderer.invoke('load-user-settings'),
  launchGame: (data: { version: string; username: string; isPremium: boolean; savedToken: any }) => ipcRenderer.send('launch-game', data),
  openModsFolder: (version: string) => ipcRenderer.send('open-mods-folder', version),
  searchMods: (data: { query: string; gameVersion: string; category?: string; offset?: number }) => ipcRenderer.invoke('search-mods', data),
  getModDetails: (projectId: string) => ipcRenderer.invoke('get-mod-details', projectId),
  getModVersions: (data: { projectId: string; gameVersion: string }) => ipcRenderer.invoke('get-mod-versions', data),
  installModFile: (data: { downloadUrl: string; fileName: string; gameVersion: string }) => ipcRenderer.invoke('install-mod-file', data),
  
  startP2PHost: (lanPort: number) => ipcRenderer.invoke('start-p2p-host', lanPort),
  connectP2PClient: (connectionCode: string) => ipcRenderer.invoke('connect-p2p-client', connectionCode),
  stopP2PSession: () => ipcRenderer.invoke('stop-p2p-session'),

  onDownloadProgress: (callback: (data: { type: string; percent?: number; text: string }) => void) => 
    ipcRenderer.on('download-progress', (_event, value) => callback(value)),
  onDownloadError: (callback: (errorText: string) => void) => 
    ipcRenderer.on('download-error', (_event, value) => callback(value)),
  onGameClosed: (callback: (code: number) => void) =>
    ipcRenderer.on('game-closed', (_event, value) => callback(value)),
  onLaunchDiagnostic: (callback: (data: { message: string; details?: string; logPath?: string }) => void) =>
    ipcRenderer.on('launch-diagnostic', (_event, value) => callback(value)),
  openLaunchLogs: () => ipcRenderer.invoke('open-launch-logs'),
  selectSkinFile: () => ipcRenderer.invoke('select-skin-file'),
  saveSkinSelection: (data: { name: string; model: string; skinUrl: string; capeUrl?: string }) => ipcRenderer.invoke('save-skin-selection', data),
  onModIncompatibility: (callback: (data: { title: string; message: string; details: string }) => void) => ipcRenderer.on('mod-incompatibility', (_event, value) => callback(value))
});