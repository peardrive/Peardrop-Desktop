/**
 * TEST HARNESS: Preload script
 * Exposes same API as main PearDrop app
 */

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  // Get the share link passed via CLI
  getShareLink: () => ipcRenderer.invoke('get-share-link'),
  
  // Same API as main app
  hyperdriveOpen: (opts) => ipcRenderer.invoke('hyperdrive-open', opts),
  hyperdriveDownload: (opts) => ipcRenderer.invoke('hyperdrive-download', opts),
  cancelDownload: (opts) => ipcRenderer.invoke('cancel-download', opts),
  
  // File system actions (for DriveActions module)
  driveGet: (id) => ipcRenderer.invoke('drive-get', id),
  openFile: (filePath) => ipcRenderer.invoke('open-file', filePath),
  showFileInFolder: (filePath) => ipcRenderer.invoke('show-file-in-folder', filePath),
  openDownloads: () => ipcRenderer.invoke('open-downloads'),
  drivesRemove: (opts) => ipcRenderer.invoke('drives-remove', opts),
  drivesPause: (id) => ipcRenderer.invoke('drives-pause', id),
  drivesResume: (id) => ipcRenderer.invoke('drives-resume', id),
  
  // Event listeners (same as main app)
  onPeerConnected: (callback) => {
    ipcRenderer.on('peer-connected', (event, data) => callback(event, data))
  },
  onPeerDisconnected: (callback) => {
    ipcRenderer.on('peer-disconnected', (event, data) => callback(event, data))
  },
  onUploadProgress: (callback) => {
    ipcRenderer.on('upload-progress', (event, data) => callback(event, data))
  },
  onFilesDownloaded: (callback) => {
    ipcRenderer.on('files-downloaded', (event, data) => callback(event, data))
  },
  onConnectionStatus: (callback) => {
    ipcRenderer.on('connection-status', (event, data) => callback(event, data))
  }
})
