/**
 * TEST HARNESS: DriveItem + HyperdriveManager Integration Test
 * 
 * PURPOSE:
 *   Test DriveItem component with REAL hyperdrive downloads, not simulated data.
 *   Uses exact same flow as main PearDrop app.
 * 
 * USAGE:
 *   cd ~/Apps/peardrop/test-drive-item
 *   npm start -- peardrop://abc123...
 * 
 * WHAT IT DOES:
 *   1. Opens minimal Electron window with DriveItem
 *   2. Connects to real hyperdrive via HyperdriveManager
 *   3. Shows real-time status: connecting → downloading → complete
 *   4. Displays actual progress, speed, peer count
 */

const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')
const { manager: hyperdriveManager } = require('../lib/hyperdrive-manager')

// Get peardrop link from CLI args
const shareLink = process.argv.find(arg => arg.startsWith('peardrop://'))

if (!shareLink) {
  console.error('Usage: npm start -- peardrop://...')
  console.error('No peardrop link provided')
  process.exit(1)
}

console.log('[Test] Starting with link:', shareLink)

let mainWindow = null
let currentDriveId = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 500,
    height: 300,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    backgroundColor: '#1a1a2e',
    titleBarStyle: 'hiddenInset',
    vibrancy: 'under-window'
  })

  mainWindow.loadFile(path.join(__dirname, 'index.html'))
  
  // Open DevTools in development
  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools()
  }
}

// ============================================================================
// IPC HANDLERS - Mirror main PearDrop app's API
// ============================================================================

// Get the share link to start download
ipcMain.handle('get-share-link', () => {
  return shareLink
})

// Open drive (connect to remote)
ipcMain.handle('hyperdrive-open', async (event, { shareLink }) => {
  console.log('[Test] Opening drive:', shareLink)
  
  try {
    const result = await hyperdriveManager.openDrive(shareLink)
    currentDriveId = result.driveId
    
    console.log('[Test] Drive opened:', {
      driveId: result.driveId,
      shareName: result.shareName,
      totalBytes: result.totalBytes,
      files: result.files.length
    })
    
    return {
      success: true,
      driveId: result.driveId,
      shareName: result.shareName,
      totalBytes: result.totalBytes,
      files: result.files
    }
  } catch (err) {
    console.error('[Test] Open failed:', err.message)
    return { success: false, error: err.message }
  }
})

// Download files
ipcMain.handle('hyperdrive-download', async (event, { driveId }) => {
  console.log('[Test] Starting download:', driveId)
  
  const session = hyperdriveManager.activeDrives.get(driveId)
  if (!session) {
    return { success: false, error: 'Drive not found' }
  }
  
  try {
    const destDir = path.join(require('os').homedir(), 'peardrop', 'downloads', 'test-' + Date.now())
    
    // Hook into blobs core for progress tracking (same as main app)
    const blobs = await session.drive.getBlobs()
    if (blobs && blobs.core) {
      let downloaded = 0
      const totalBytes = session.totalBytes || 1
      
      blobs.core.on('download', (index, byteLength) => {
        downloaded += byteLength
        const percent = Math.round((downloaded / totalBytes) * 100)
        const progress = downloaded / totalBytes
        
        // Send progress to renderer (same event name as main app)
        mainWindow.webContents.send('upload-progress', {
          driveId,
          peerId: 'self',
          percent,
          progress,
          bytesDownloaded: downloaded,
          totalBytes,
          speedFormatted: '' // Would need speed calc
        })
        
        console.log('[Test] Progress:', percent + '%')
      })
    }
    
    // Download all files
    const files = []
    for await (const entry of session.drive.list('/')) {
      if (entry.key === '/.peardrop.json') continue
      
      const data = await session.drive.get(entry.key)
      if (data) {
        const filename = path.basename(entry.key)
        const destPath = path.join(destDir, filename)
        await require('fs').promises.mkdir(path.dirname(destPath), { recursive: true })
        await require('fs').promises.writeFile(destPath, data)
        files.push({ name: filename, path: destPath, size: data.length })
        console.log('[Test] Downloaded:', filename)
      }
    }
    
    // Store file info in HyperdriveManager for file operations
    hyperdriveManager.setDownloadedFiles(driveId, files, destDir)
    
    // Send completion
    mainWindow.webContents.send('files-downloaded', {
      driveId,
      files,
      destDir
    })
    
    console.log('[Test] Download complete:', files.length, 'files')
    
    return { success: true, files, destDir }
  } catch (err) {
    console.error('[Test] Download failed:', err.message)
    return { success: false, error: err.message }
  }
})

// Cancel download
ipcMain.handle('cancel-download', async (event, { driveId }) => {
  console.log('[Test] Cancelling:', driveId)
  hyperdriveManager.abortConnection(driveId)
  if (hyperdriveManager.activeDrives.has(driveId)) {
    await hyperdriveManager.stopDrive(driveId, { purge: true })
  }
  return { success: true }
})

// ============================================================================
// FILE SYSTEM ACTIONS (using HyperdriveManager's built-in methods)
// ============================================================================

// Get drive info - uses HyperdriveManager.getDriveInfo()
ipcMain.handle('drive-get', async (event, driveId) => {
  console.log('[Test] drive-get:', driveId)
  return hyperdriveManager.getDriveInfo(driveId)
})

// Open file in default app - uses HyperdriveManager.openFile()
ipcMain.handle('open-file', async (event, filePath) => {
  console.log('[Test] open-file:', filePath)
  // For direct file path calls, use shell directly
  const { shell } = require('electron')
  try {
    const result = await shell.openPath(filePath)
    return { success: !result, error: result || undefined }
  } catch (err) {
    return { success: false, error: err.message }
  }
})

// Show file in Finder/Explorer - uses HyperdriveManager.showInFolder()
ipcMain.handle('show-file-in-folder', async (event, filePath) => {
  console.log('[Test] show-file-in-folder:', filePath)
  const { shell } = require('electron')
  try {
    shell.showItemInFolder(filePath)
    return { success: true }
  } catch (err) {
    return { success: false, error: err.message }
  }
})

// Open downloads folder - uses HyperdriveManager.openDownloadsFolder()
ipcMain.handle('open-downloads', async () => {
  console.log('[Test] open-downloads')
  return hyperdriveManager.openDownloadsFolder()
})

// Remove drive
ipcMain.handle('drives-remove', async (event, { id, deleteFiles }) => {
  console.log('[Test] drives-remove:', id, { deleteFiles })
  try {
    await hyperdriveManager.stopDrive(id, { purge: true })
    return { success: true }
  } catch (err) {
    return { success: false, error: err.message }
  }
})

// Pause/Resume (placeholder - needs implementation in HyperdriveManager)
ipcMain.handle('drives-pause', async (event, driveId) => {
  console.log('[Test] drives-pause:', driveId)
  // TODO: Implement pause in HyperdriveManager
  return { success: true }
})

ipcMain.handle('drives-resume', async (event, driveId) => {
  console.log('[Test] drives-resume:', driveId)
  // TODO: Implement resume in HyperdriveManager
  return { success: true }
})

// ============================================================================
// HyperdriveManager Events → Renderer
// ============================================================================

function setupHyperdriveEvents() {
  hyperdriveManager.on('peer-connected', (data) => {
    console.log('[Test] Peer connected:', data)
    if (mainWindow) {
      mainWindow.webContents.send('peer-connected', data)
    }
  })
  
  hyperdriveManager.on('peer-disconnected', (data) => {
    console.log('[Test] Peer disconnected:', data)
    if (mainWindow) {
      mainWindow.webContents.send('peer-disconnected', data)
    }
  })
  
  hyperdriveManager.on('upload-progress', (data) => {
    if (mainWindow) {
      mainWindow.webContents.send('upload-progress', data)
    }
  })
  
  hyperdriveManager.on('connection-status', (data) => {
    console.log('[Test] Connection status:', data)
    if (mainWindow) {
      mainWindow.webContents.send('connection-status', data)
    }
  })
}

// ============================================================================
// App Lifecycle
// ============================================================================

app.whenReady().then(async () => {
  await hyperdriveManager.init()
  setupHyperdriveEvents()
  createWindow()
})

app.on('window-all-closed', async () => {
  // Cleanup
  if (currentDriveId) {
    try {
      await hyperdriveManager.stopDrive(currentDriveId, { purge: true })
    } catch (err) {
      // Ignore
    }
  }
  app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})
