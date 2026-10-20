const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('cscApi', {
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  downloadUpdateNow: () => ipcRenderer.invoke('download-update-now'),
  installUpdateNow: () => ipcRenderer.invoke('install-update-now'),
  onUpdateStatus: (callback) => ipcRenderer.on('update-status', (_event, data) => callback(data)),
  getTelemetry: () => ipcRenderer.invoke('get-telemetry'),
  optimizeSystem: () => ipcRenderer.invoke('optimize-system'),
  setPowerPlan: (plan) => ipcRenderer.invoke('set-power-plan', plan),
  getInstalledApps: () => ipcRenderer.invoke('get-installed-apps'),
  uninstallApp: (appObj) => ipcRenderer.invoke('uninstall-app', appObj),
  getDisks: () => ipcRenderer.invoke('get-disks'),
  scanDisk: (driveId) => ipcRenderer.invoke('scan-disk', driveId),
  deleteDiskItem: (targetPath) => ipcRenderer.invoke('delete-disk-item', targetPath),
  openInExplorer: (targetPath) => ipcRenderer.invoke('open-in-explorer', targetPath),
  saveAIKeys: (keys) => ipcRenderer.invoke('save-ai-keys', keys),
  loadAIKeys: () => ipcRenderer.invoke('load-ai-keys'),
  fetchAIUsage: (keys) => ipcRenderer.invoke('fetch-ai-usage', keys),
  getAIProcessTelemetry: () => ipcRenderer.invoke('get-ai-process-telemetry')
});
