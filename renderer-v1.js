/**
 * MODULE: renderer.js
 * PURPOSE: UI logic for PearDrop - file selection, sharing, downloading
 * 
 * EXPORTS: None (DOM script)
 * 
 * DESIGN NOTES (v0.13.1):
 *   - UNIFIED PROGRESS UI: All transfers use lib/transfer-blob.js component
 *   - HOME BLOCKS SYSTEM: lib/home-blocks.js manages notification slot (single notification at a time)
 *   - ONE component for all states: waiting, connecting, transferring, complete, error
 *   - Progress bar always visible (pulses when waiting, fills when transferring)
 *   - Fade transitions (not swipe) for smooth UI
 *   - 15 second auto-dismiss with "Moved to Shares" message
 *   - Shares tab shows upload progress when peers are downloading
 *   - See lib/transfer-blob.js for the universal TransferBlob component
 *   - See lib/home-blocks.js for the notification management system
 * 
 * FUNCTIONS:
 *   File Selection:
 *     - selectFiles() - Open file picker dialog
 *     - handleFiles(files) - Process dropped/selected files (async, expands folders)
 *     - clearFiles() - Reset dropzone UI only (drive keeps seeding in background)
 * 
 *   Share Flow:
 *     - showShareModal() - Create share or show existing link
 *     - copyShareLink() - Copy link to clipboard
 *     - closeShareModal() - Close modal, show pending transfer
 * 
 *   Download Flow:
 *     - showDownloadModal() - Show download link input
 *     - startDownload() - Connect and download from link (includes dedup check)
 *     - cancelDownload() - Abort pending connection
 *     - showStatus(type, msg) - Show status in download modal
 *     - showDuplicateMessage() - Show "already have" notification
 *     - closeDownloadModal() - Close download modal (also cancels pending)
 * 
 *   Transfer UI (UNIFIED via lib/transfer-blob.js):
 *     - renderTransfers() - Render all transfers using TransferBlob component
 *     - updateTransferUI(peerId, peer) - Update upload transfer (no re-render)
 *     - updateDownloadUI(driveId, download) - Update download transfer (no re-render)
 *     - copyPendingLink() - Copy pending share link
 *     - stopPendingShare() - Cancel pending share
 *     NOTE: Old createPendingShareHTML/createPendingDownloadHTML/createTransferItemHTML
 *           functions are now DEPRECATED - use TransferBlob.createTransferBlob() instead
 * 
 *   Utilities:
 *     - formatFileSize(bytes) - "1.2 MB"
 *     - getFileIcon(filename) - Emoji for file type
 * 
 * IPC CALLS (via window.electronAPI):
 *   - hyperdriveShare, hyperdriveStop, hyperdriveOpen, hyperdriveDownload
 *   - drivesList, drivesPause, drivesResume, drivesRemove, drivesCheckFiles
 *   - openDownloads, getFilesStats
 * 
 * IPC LISTENERS:
 *   - onPeerConnected, onPeerDisconnected
 *   - onUploadProgress, onUploadComplete
 *   - onFilesDownloaded, onDrivesUpdated, onDownloadPeerDisconnected
 * 
 * KEY STATE:
 *   - activeFiles[] - Files selected for sharing
 *   - currentShareLink, currentDriveId - Active share info
 *   - pendingShare - { driveId, shareLink, fileName, totalBytes }
 *   - pendingShareTimer - Auto-dismiss timer for pendingShare (5s)
 *   - pendingDownloads (Map) - driveId -> { shareLink, status, percent, ... }
 *   - activePeers (Map) - peerId -> transfer state
 *   - drives[] - All drives from DriveManager (single source of truth)
 */

// DOM Elements
const dropZone = document.getElementById('dropZone');
const dropContent = document.getElementById('dropContent');
const filePreview = document.getElementById('filePreview');
const fileIcon = document.getElementById('fileIcon');
const fileName = document.getElementById('fileName');
const fileSize = document.getElementById('fileSize');
const clearBtn = document.getElementById('clearBtn');
const shareBtn = document.getElementById('shareBtn');
const downloadBtn = document.getElementById('downloadBtn');

// Share Modal
const shareModal = document.getElementById('shareModal');
const shareLinkDisplay = document.getElementById('shareLinkDisplay');
const copyLinkBtn = document.getElementById('copyLinkBtn');
const closeShareBtn = document.getElementById('closeShareBtn');

// Download Modal
const downloadModal = document.getElementById('downloadModal');
const downloadLinkInput = document.getElementById('downloadLinkInput');
const downloadStatus = document.getElementById('downloadStatus');
const startDownloadBtn = document.getElementById('startDownloadBtn');
const closeDownloadBtn = document.getElementById('closeDownloadBtn');

// Transfers
const transfersContainer = document.getElementById('transfers');

// Tabs
const tabButtons = document.querySelectorAll('.tab-btn');
const homeTab = document.getElementById('homeTab');
const sharesTab = document.getElementById('sharesTab');
const sharesList = document.getElementById('sharesList');
const sharesEmpty = document.getElementById('sharesEmpty');

// State
let activeFiles = [];
let currentShareLink = null;
let currentDriveId = null;
let activePeers = new Map(); // peerId -> { driveId, percent, speed, ... }
let pendingShare = null; // { driveId, shareLink, fileName, totalBytes }
let pendingShareTimer = null; // Timer for auto-dismissing pendingShare
let pendingDownloads = new Map(); // driveId -> { shareLink, status, startedAt, aborted }
let drives = []; // Array of drive entries from DriveManager

// ============================================================================
// File Selection
// ============================================================================

function selectFiles() {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    // Enable folder selection on supported browsers
    input.webkitdirectory = false;  // Set to true if you want folder-only mode
    input.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            handleFiles(Array.from(e.target.files));
        }
    });
    input.click();
}

async function handleFiles(files) {
    if (!files || files.length === 0) return;
    
    // Get paths from dropped files
    const paths = files.map(f => f.path).filter(Boolean);
    if (paths.length === 0) return;
    
    // Use backend to get proper stats (handles folder expansion)
    try {
        const stats = await window.electronAPI.getFilesStats(paths);
        
        activeFiles = stats.map(s => ({
            name: s.name,
            size: s.size,
            path: s.path,
            type: s.type,
            fileCount: s.fileCount,  // For folders
            contents: s.contents      // Folder contents for sharing
        }));
    } catch (err) {
        console.error('Failed to get file stats:', err);
        // Fallback to basic file info
        activeFiles = files.map(file => ({
            name: file.name,
            size: file.size,
            path: file.path,
            type: file.type
        }));
    }
    
    // Update UI
    dropContent.classList.add('hidden');
    filePreview.classList.add('active');
    dropZone.classList.add('has-files');
    shareBtn.disabled = false;
    
    // Set preview info
    if (activeFiles.length === 1) {
        const file = activeFiles[0];
        if (file.type === 'folder' && file.fileCount) {
            fileName.textContent = `${file.name} (${file.fileCount} files)`;
        } else {
            fileName.textContent = file.name;
        }
        fileSize.textContent = formatFileSize(file.size);
        fileIcon.textContent = file.type === 'folder' ? '📁' : getFileIcon(file.name);
    } else {
        const totalSize = activeFiles.reduce((sum, f) => sum + f.size, 0);
        const totalFiles = activeFiles.reduce((sum, f) => sum + (f.fileCount || 1), 0);
        fileName.textContent = `${totalFiles} files`;
        fileSize.textContent = formatFileSize(totalSize);
        fileIcon.textContent = '📦';
    }
}

function clearFiles() {
    activeFiles = [];
    dropContent.classList.remove('hidden');
    filePreview.classList.remove('active');
    dropZone.classList.remove('has-files');
    shareBtn.disabled = true;
    
    // Just clear the UI references - drive continues seeding in background
    // (visible in Shares tab, can be stopped from there)
    currentDriveId = null;
    currentShareLink = null;
    
    // Clear pending share from Home view (it's still in Shares tab)
    if (pendingShare) {
        if (pendingShareTimer) {
            clearTimeout(pendingShareTimer);
            pendingShareTimer = null;
        }
        pendingShare = null;
        renderTransfers();
    }
}

// ============================================================================
// Share Flow
// ============================================================================

async function showShareModal() {
    if (activeFiles.length === 0) return;
    
    // Check if we already have a pending share for the same file(s)
    if (pendingShare && currentShareLink) {
        const currentFileName = activeFiles.length === 1 
            ? activeFiles[0].name 
            : `${activeFiles.length} files`;
        
        // If same file is already being shared, just show existing link
        if (pendingShare.fileName === currentFileName) {
            shareModal.classList.add('active');
            shareLinkDisplay.textContent = currentShareLink;
            shareLinkDisplay.classList.remove('loading');
            copyLinkBtn.disabled = false;
            copyLinkBtn.textContent = 'Copy Link';
            console.log('Reusing existing share:', currentShareLink);
            return;
        }
    }
    
    shareModal.classList.add('active');
    shareLinkDisplay.textContent = 'Creating link...';
    shareLinkDisplay.classList.add('loading');
    copyLinkBtn.disabled = true;
    
    try {
        const result = await window.electronAPI.hyperdriveShare({
            files: activeFiles,
            options: {
                name: activeFiles.length === 1 
                    ? activeFiles[0].name 
                    : `${activeFiles.length} files`
            }
        });
        
        if (result.success) {
            currentShareLink = result.shareLink;
            currentDriveId = result.driveId;
            
            shareLinkDisplay.textContent = result.shareLink;
            shareLinkDisplay.classList.remove('loading');
            copyLinkBtn.disabled = false;
            
            // Set up pending share state
            const totalBytes = activeFiles.reduce((sum, f) => sum + f.size, 0);
            const fileName = activeFiles.length === 1 
                ? activeFiles[0].name 
                : `${activeFiles.length} files`;
            
            // Store in legacy state (for backwards compatibility)
            pendingShare = {
                driveId: result.driveId,
                shareLink: result.shareLink,
                fileName,
                totalBytes
            };
            
            console.log('Share link created:', result.shareLink);
            
            // Immediately load drives so it appears in Shares list
            loadDrives();
            
            // Show notification using HomeBlocks (single notification system)
            if (window.HomeBlocks) {
                window.HomeBlocks.showNotification({
                    id: result.driveId,
                    type: 'upload-waiting',
                    name: fileName,
                    totalBytes: totalBytes,
                    shareLink: result.shareLink,
                    autoDismissMs: 15000, // 15 seconds before auto-dismiss
                    onDismiss: () => {
                        // Clean up legacy state when dismissed
                        if (pendingShare && pendingShare.driveId === result.driveId) {
                            pendingShare = null;
                        }
                        loadDrives(); // Refresh shares list
                    }
                });
                
                // Add has-notification class to dropzone for layout
                dropZone.classList.add('has-notification');
            }
            
            // Listen for dismiss events from the notification
            const handleDismiss = (e) => {
                if (e.detail.id === result.driveId) {
                    // User clicked stop - actually stop the share
                    window.electronAPI.hyperdriveStop({ driveId: result.driveId, purge: true });
                    pendingShare = null;
                    dropZone.classList.remove('has-notification');
                    loadDrives();
                    window.removeEventListener('notification-dismiss', handleDismiss);
                }
            };
            window.addEventListener('notification-dismiss', handleDismiss);
        } else {
            shareLinkDisplay.textContent = `Error: ${result.error}`;
            shareLinkDisplay.classList.remove('loading');
        }
    } catch (error) {
        console.error('Failed to create share:', error);
        shareLinkDisplay.textContent = `Error: ${error.message}`;
        shareLinkDisplay.classList.remove('loading');
    }
}

function copyShareLink() {
    if (currentShareLink) {
        navigator.clipboard.writeText(currentShareLink);
        copyLinkBtn.textContent = 'Copied!';
        
        // Reset button text after a moment, but DON'T auto-close
        // User must click "Done" to close - gives them time to re-copy if needed
        setTimeout(() => {
            copyLinkBtn.textContent = 'Copy Link';
        }, 1500);
    }
}

function closeShareModalAndShowPending() {
    closeShareModal();
    renderTransfers();
}

function closeShareModal() {
    shareModal.classList.remove('active');
    // Show pending transfer on main screen
    renderTransfers();
}

// ============================================================================
// Download Flow
// ============================================================================

function showDownloadModal() {
    downloadModal.classList.add('active');
    downloadLinkInput.value = '';
    downloadStatus.innerHTML = '';
    downloadLinkInput.focus();
}

async function startDownload() {
    const link = downloadLinkInput.value.trim();
    
    if (!link) {
        showStatus('error', 'Please paste a PearDrop link');
        return;
    }
    
    if (!link.startsWith('peardrop://')) {
        showStatus('error', 'Invalid link format');
        return;
    }
    
    // Generate a temporary ID for tracking until we get the real driveId
    const tempId = `download_${Date.now()}`;
    
    // Add to pending downloads immediately and show in UI
    pendingDownloads.set(tempId, {
        shareLink: link,
        status: 'connecting',
        startedAt: Date.now(),
        aborted: false
    });
    renderTransfers();
    
    // Close modal - download continues in background, visible in transfers
    closeDownloadModal();
    
    try {
        // Open the remote drive
        const openResult = await window.electronAPI.hyperdriveOpen({ shareLink: link });
        
        // Check if user cancelled while we were connecting
        const pendingDl = pendingDownloads.get(tempId);
        if (pendingDl?.aborted) {
            console.log('Download was cancelled');
            pendingDownloads.delete(tempId);
            renderTransfers();
            return;
        }
        
        if (!openResult.success) {
            // Update status to show error
            if (pendingDownloads.has(tempId)) {
                pendingDownloads.get(tempId).status = 'error';
                pendingDownloads.get(tempId).error = openResult.error || 'Failed to connect';
                renderTransfers();
                // Remove after showing error briefly
                setTimeout(() => {
                    pendingDownloads.delete(tempId);
                    renderTransfers();
                }, 5000);
            }
            return;
        }
        
        // Handle duplicate detection
        if (openResult.isDuplicate) {
            pendingDownloads.delete(tempId);
            
            if (openResult.localStatus === 'valid') {
                // File exists - show message and switch to Shares tab
                console.log('Already have this file:', openResult.shareName);
                showDuplicateMessage(openResult, 'valid');
                return;
            } else if (openResult.localStatus === 'missing') {
                // File was deleted - offer to re-download
                console.log('Previously downloaded but file missing:', openResult.shareName);
                const redownload = confirm(`"${openResult.shareName}" was previously downloaded but the file is missing.\n\nRe-download?`);
                if (!redownload) {
                    return;
                }
                // Proceed with download below (don't return)
            } else if (openResult.localStatus === 'partial') {
                // Partial download - offer to resume/re-download
                console.log('Partial download found:', openResult.shareName);
                const redownload = confirm(`"${openResult.shareName}" has an incomplete download.\n\nRe-download?`);
                if (!redownload) {
                    return;
                }
            }
            
            // If re-downloading, we need to re-open the drive (since we didn't open it for duplicates)
            const reopenResult = await window.electronAPI.hyperdriveOpen({ shareLink: link, forceOpen: true });
            if (!reopenResult.success) {
                showStatus('error', reopenResult.error || 'Failed to connect for re-download');
                return;
            }
            openResult.driveId = reopenResult.driveId;
            openResult.isDuplicate = false;
        }
        
        // Update with real driveId and start downloading
        pendingDownloads.delete(tempId);
        
        const downloadEntry = {
            shareLink: link,
            shareName: openResult.shareName,
            totalBytes: openResult.totalBytes,
            status: 'downloading',
            startedAt: Date.now(),
            aborted: false,
            percent: 0
        };
        
        pendingDownloads.set(openResult.driveId, downloadEntry);
        
        // Also add to drives array (for Shares tab) - will be updated when complete
        drives.unshift({
            id: openResult.driveId,
            key: link.replace('peardrop://', ''),
            shareLink: link,
            name: openResult.shareName,
            totalBytes: openResult.totalBytes,
            state: 'downloading',
            isUpload: false,
            createdAt: new Date().toISOString(),
            stats: { peers: 0 }
        });
        
        renderTransfers();
        renderDrives();
        
        // Download all files
        const downloadResult = await window.electronAPI.hyperdriveDownload({
            driveId: openResult.driveId
        });
        
        if (downloadResult.success) {
            pendingDownloads.delete(openResult.driveId);
            renderTransfers();
            // Open downloads folder after transfer completes
            setTimeout(() => {
                window.electronAPI.openDownloads();
            }, 500);
        } else {
            // Show error
            if (pendingDownloads.has(openResult.driveId)) {
                pendingDownloads.get(openResult.driveId).status = 'error';
                pendingDownloads.get(openResult.driveId).error = downloadResult.error;
                renderTransfers();
            }
        }
    } catch (error) {
        console.error('Download failed:', error);
        // Update status
        if (pendingDownloads.has(tempId)) {
            const dl = pendingDownloads.get(tempId);
            if (!dl.aborted) {
                dl.status = 'error';
                dl.error = error.message;
                renderTransfers();
            }
        }
    }
}

// Old cancelDownload removed - replaced by cancelAndDeleteDownload with confirmation

function showStatus(type, message) {
    downloadStatus.className = `status ${type}`;
    downloadStatus.textContent = message;
}

// Show duplicate file message and switch to Shares tab
function showDuplicateMessage(openResult, status) {
    const name = openResult.shareName || 'This file';
    const size = openResult.totalBytes ? formatFileSize(openResult.totalBytes) : '';
    
    // Create a brief notification
    const msg = status === 'valid' 
        ? `✅ Already have "${name}"${size ? ` (${size})` : ''}`
        : `⚠️ "${name}" was previously downloaded`;
    
    // Show in transfers area briefly
    const notificationId = `dup_${Date.now()}`;
    pendingDownloads.set(notificationId, {
        shareLink: openResult.existingDrive?.shareLink || '',
        shareName: name,
        status: 'duplicate',
        message: msg,
        startedAt: Date.now()
    });
    renderTransfers();
    
    // Remove notification and switch to Shares tab
    setTimeout(() => {
        pendingDownloads.delete(notificationId);
        renderTransfers();
        // Switch to Shares tab to show existing
        switchTab('shares');
    }, 2500);
}

function closeDownloadModal() {
    // Just close the modal - download continues in background
    // User can cancel from the transfers list if needed
    downloadModal.classList.remove('active');
    downloadStatus.innerHTML = '';
    closeDownloadBtn.textContent = 'Close';
}

// ============================================================================
// Event Listeners
// ============================================================================

// Drop zone
dropZone.addEventListener('click', (e) => {
    if (e.target === clearBtn) return;
    if (activeFiles.length === 0) {
        selectFiles();
    }
});

dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
});

dropZone.addEventListener('dragleave', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
});

dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
        handleFiles(files);
    }
});

clearBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    clearFiles();
});

// Action buttons
shareBtn.addEventListener('click', showShareModal);
downloadBtn.addEventListener('click', showDownloadModal);

// Share modal
copyLinkBtn.addEventListener('click', copyShareLink);
closeShareBtn.addEventListener('click', closeShareModal);
shareModal.addEventListener('click', (e) => {
    if (e.target === shareModal) closeShareModal();
});

// Download modal
startDownloadBtn.addEventListener('click', startDownload);
closeDownloadBtn.addEventListener('click', closeDownloadModal);
downloadModal.addEventListener('click', (e) => {
    if (e.target === downloadModal) closeDownloadModal();
});

downloadLinkInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') startDownload();
});

// Listen for download completion
window.electronAPI.onFilesDownloaded((event, data) => {
    console.log('Files downloaded:', data);
});

// ============================================================================
// Transfer Progress (Upload/Download)
// ============================================================================

// Peer connected - show transfer item
window.electronAPI.onPeerConnected((event, data) => {
    console.log('Peer connected:', data);
    
    // If share modal is open and this is a real peer (not self), close it
    // so user can watch upload progress on main screen
    if (data.peerId !== 'self' && shareModal.classList.contains('active')) {
        closeShareModal();
    }
    
    // For downloads (peerId === 'self'), update the existing pendingDownloads entry
    // instead of creating a new activePeers entry
    if (data.peerId === 'self') {
        // Find and update the pending download for this drive
        for (const [downloadId, download] of pendingDownloads) {
            if (download.status === 'connecting' || download.status === 'downloading') {
                download.status = 'downloading';
                download.shareName = data.shareName || download.shareName;
                download.totalBytes = data.totalBytes || download.totalBytes;
                download.percent = 0;
                download.bytesFormatted = '0 B';
                download.speedFormatted = '—';
                renderTransfers();
                return;
            }
        }
        // If no pending download found, ignore (shouldn't happen normally)
        return;
    }
    
    // For uploads (real peers connecting to download from us)
    let totalBytes = data.totalBytes || 0;
    let displayName = data.shareName || null;
    
    if (pendingShare && pendingShare.driveId === data.driveId) {
        totalBytes = pendingShare.totalBytes;
        displayName = pendingShare.fileName;
    }
    
    if (!activePeers.has(data.peerId)) {
        activePeers.set(data.peerId, {
            driveId: data.driveId,
            displayName,
            totalBytes,
            percent: 0,
            bytesFormatted: '0 B',
            totalFormatted: totalBytes ? formatFileSize(totalBytes) : '—',
            speedFormatted: '—'
        });
        
        // Update HomeBlocks notification to show upload in progress
        if (window.HomeBlocks && window.HomeBlocks.getCurrentNotification()) {
            const notif = window.HomeBlocks.getCurrentNotification();
            if (notif.id === data.driveId || notif.type === 'upload-waiting') {
                window.HomeBlocks.updateNotification({
                    type: 'upload-progress',
                    name: displayName || notif.name,
                    percent: 0,
                    bytesTransferred: 0,
                    totalBytes: totalBytes,
                    speed: ''
                });
            }
        }
        
        renderTransfers();
    }
});

// Peer disconnected - remove transfer item
window.electronAPI.onPeerDisconnected((event, data) => {
    console.log('Peer disconnected:', data);
    
    // Keep showing for a moment then remove
    setTimeout(() => {
        activePeers.delete(data.peerId);
        renderTransfers();
    }, 1000);
});

// Upload/Download progress update
window.electronAPI.onUploadProgress((event, data) => {
    // For downloads (peerId === 'self'), update pendingDownloads
    if (data.peerId === 'self') {
        for (const [downloadId, download] of pendingDownloads) {
            if (download.status === 'downloading') {
                download.percent = data.percent;
                download.bytesFormatted = data.bytesFormatted;
                download.totalFormatted = data.totalFormatted;
                download.speedFormatted = data.speedFormatted;
                updateDownloadUI(downloadId, download);
                
                // Also update the drives array for Shares tab (if visible)
                const drive = drives.find(d => d.id === downloadId);
                if (drive && sharesTab.classList.contains('active')) {
                    renderDrives(); // Re-render to show updated progress
                }
                return;
            }
        }
        return;
    }
    
    // For uploads (real peers)
    const peer = activePeers.get(data.peerId);
    if (peer) {
        peer.percent = data.percent;
        peer.bytesFormatted = data.bytesFormatted;
        peer.totalFormatted = data.totalFormatted;
        peer.speedFormatted = data.speedFormatted;
        peer.bytesTransferred = data.bytesTransferred || 0;
        updateTransferUI(data.peerId, peer);
        
        // Also update HomeBlocks notification
        if (window.HomeBlocks && window.HomeBlocks.getCurrentNotification()) {
            const notif = window.HomeBlocks.getCurrentNotification();
            if (notif.type === 'upload-progress' || notif.type === 'upload-waiting') {
                window.HomeBlocks.updateNotification({
                    type: 'upload-progress',
                    percent: data.percent,
                    bytesTransferred: data.bytesTransferred || 0,
                    speed: data.speedFormatted || ''
                });
            }
        }
        
        // Re-render Shares tab if active to show upload progress
        if (sharesTab.classList.contains('active')) {
            renderDrives();
        }
    }
});

// Upload/Download complete
window.electronAPI.onUploadComplete((event, data) => {
    console.log('Transfer complete:', data);
    
    // For downloads (peerId === 'self'), update status - DON'T remove, now seeding
    if (data.peerId === 'self') {
        for (const [downloadId, download] of pendingDownloads) {
            if (download.status === 'downloading') {
                download.status = 'complete';
                download.percent = 100;
                updateDownloadUI(downloadId, download);
                
                // Update the drive in Shares tab to show as 'active' (seeding)
                const drive = drives.find(d => d.id === downloadId);
                if (drive) {
                    drive.state = 'active';
                    renderDrives();
                }
                
                // Keep showing for a few seconds on Home, then remove from pending
                setTimeout(() => {
                    pendingDownloads.delete(downloadId);
                    renderTransfers();
                }, 3000);
                return;
            }
        }
        return;
    }
    
    // For uploads (real peers) - show completion, then fade to Shares
    const peer = activePeers.get(data.peerId);
    if (peer) {
        peer.percent = 100;
        peer.complete = true;
        updateTransferUI(data.peerId, peer);
        
        // Update HomeBlocks to show complete
        if (window.HomeBlocks && window.HomeBlocks.getCurrentNotification()) {
            window.HomeBlocks.updateNotification({
                type: 'complete',
                percent: 100
            });
        }
        
        // After 2 seconds, remove peer and fade notification
        setTimeout(() => {
            activePeers.delete(data.peerId);
            
            // If no more active peers for this share, fade to "Moved to Shares"
            const remainingPeers = Array.from(activePeers.values()).filter(p => p.driveId === peer.driveId);
            if (remainingPeers.length === 0 && pendingShare && pendingShare.driveId === peer.driveId) {
                pendingShare = null;
                
                // Use HomeBlocks to show "Moved to Shares" with fade
                if (window.HomeBlocks) {
                    window.HomeBlocks.hideNotification({ 
                        showMoved: true, 
                        movedDuration: 3000 
                    });
                    
                    // Remove has-notification class after fade
                    setTimeout(() => {
                        dropZone.classList.remove('has-notification');
                    }, 3300);
                }
                
                loadDrives(); // Refresh shares list
            }
            
            renderTransfers();
        }, 2000);
    }
});

// Show "Moved to Shares" notification after upload completes
function showMovedToShares(share) {
    const notificationId = `moved_${Date.now()}`;
    pendingDownloads.set(notificationId, {
        shareName: share.fileName || 'Share',
        status: 'moved',
        message: 'Moved to Shares →'
    });
    renderTransfers();
    
    // Refresh Shares tab to show the completed upload
    loadDrives();
    
    // Remove notification after 4 seconds
    setTimeout(() => {
        pendingDownloads.delete(notificationId);
        renderTransfers();
    }, 4000);
}

// Download peer disconnected - sender went offline
window.electronAPI.onDownloadPeerDisconnected((event, data) => {
    console.log('Download peer disconnected:', data);
    
    // Find any active download and mark it as failed
    for (const [downloadId, download] of pendingDownloads) {
        if (download.status === 'downloading' || download.status === 'connecting') {
            download.status = 'error';
            download.error = 'Sender went offline';
            renderTransfers();
            
            // Remove after showing error
            setTimeout(() => {
                pendingDownloads.delete(downloadId);
                renderTransfers();
            }, 5000);
            return;
        }
    }
});

// Render all transfer items
function renderTransfers() {
    // Show if we have pending share, pending downloads, OR active peers
    if (!pendingShare && pendingDownloads.size === 0 && activePeers.size === 0) {
        transfersContainer.classList.add('hidden');
        transfersContainer.innerHTML = '';
        return;
    }
    
    transfersContainer.classList.remove('hidden');
    
    let html = '';
    
    // Show pending share (waiting for peers) if no active transfers
    if (pendingShare) {
        const hasActiveTransfer = Array.from(activePeers.values())
            .some(p => p.driveId === pendingShare.driveId);
        
        if (!hasActiveTransfer) {
            html += window.TransferBlob.createTransferBlob({
                id: pendingShare.driveId,
                name: pendingShare.fileName,
                type: 'upload',
                state: 'waiting',
                totalBytes: pendingShare.totalBytes,
                shareLink: pendingShare.shareLink,
                context: 'home'
            });
        }
    }
    
    // Show pending downloads
    for (const [driveId, download] of pendingDownloads) {
        // Determine state from download.status
        let state = 'connecting';
        if (download.status === 'downloading') state = 'transferring';
        else if (download.status === 'complete') state = 'complete';
        else if (download.status === 'error' || download.status === 'cancelled') state = 'error';
        else if (download.status === 'moved') state = 'moved';
        else if (download.status === 'duplicate') state = 'complete';
        
        html += window.TransferBlob.createTransferBlob({
            id: driveId,
            name: download.shareName || 'Download',
            type: 'download',
            state: state,
            percent: download.percent || 0,
            bytesTransferred: download.bytesTransferred || 0,
            totalBytes: download.totalBytes || 0,
            speed: download.speedFormatted || '',
            shareLink: download.shareLink || '',
            context: 'home',
            error: download.error || download.message || ''
        });
    }
    
    // Show active peer uploads
    for (const [peerId, peer] of activePeers) {
        const state = peer.complete ? 'complete' : 'transferring';
        html += window.TransferBlob.createTransferBlob({
            id: peer.driveId,
            peerId: peerId,
            name: peer.displayName || `Peer ${peerId.slice(0, 6)}`,
            type: 'upload',
            state: state,
            percent: peer.percent || 0,
            bytesTransferred: peer.bytesTransferred || 0,
            totalBytes: peer.totalBytes || 0,
            speed: peer.speedFormatted || '',
            context: 'home'
        });
    }
    
    transfersContainer.innerHTML = html;
    
    // Add event listeners for blob buttons
    transfersContainer.querySelectorAll('.stop-pending-btn').forEach(btn => {
        btn.addEventListener('click', stopPendingShare);
    });
    
    transfersContainer.querySelectorAll('.copy-link-btn').forEach(btn => {
        btn.addEventListener('click', copyPendingLink);
    });
    
    transfersContainer.querySelectorAll('.minimize-download-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const driveId = e.target.closest('.transfer-blob').dataset.driveId;
            if (driveId) minimizeDownload(driveId);
        });
    });
    
    transfersContainer.querySelectorAll('.cancel-download-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const driveId = e.target.closest('.transfer-blob').dataset.driveId;
            if (driveId) cancelAndDeleteDownload(driveId);
        });
    });
    
    transfersContainer.querySelectorAll('.dismiss-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const driveId = e.target.closest('.transfer-blob').dataset.driveId;
            if (driveId) {
                pendingDownloads.delete(driveId);
                renderTransfers();
            }
        });
    });
}

// Minimize download - remove from Home, stays in Shares
function minimizeDownload(driveId) {
    pendingDownloads.delete(driveId);
    renderTransfers();
    // Download continues in background, visible in Shares tab
}

// Cancel and permanently delete download
async function cancelAndDeleteDownload(driveId) {
    const download = pendingDownloads.get(driveId);
    const name = download?.shareName || 'this download';
    
    if (!confirm(`Cancel and delete "${name}" permanently?`)) {
        return;
    }
    
    // Abort the download
    try {
        await window.electronAPI.hyperdriveAbort({ driveId });
    } catch (err) {
        console.log('Abort error (may already be complete):', err);
    }
    
    // Remove from DriveManager (deletes storage)
    try {
        await window.electronAPI.drivesRemove({ id: driveId, deleteFiles: true });
    } catch (err) {
        console.log('Remove error:', err);
    }
    
    // Remove from UI
    pendingDownloads.delete(driveId);
    drives = drives.filter(d => d.id !== driveId);
    renderTransfers();
    renderDrives();
}

// Copy link from pending share
function copyPendingLink(e) {
    if (pendingShare?.shareLink) {
        navigator.clipboard.writeText(pendingShare.shareLink);
        
        // Visual feedback on the button that was clicked
        const btn = e?.target;
        if (btn && btn.classList.contains('copy-link-btn')) {
            const original = btn.textContent;
            btn.textContent = 'Copied!';
            setTimeout(() => {
                btn.textContent = original;
            }, 1500);
        }
    }
}

// Create HTML for pending share - MINIMAL collapsed bar
function createPendingShareHTML(share) {
    // Count connected peers for this share
    const peerCount = Array.from(activePeers.values()).filter(p => p.driveId === share.driveId).length;
    const peerText = peerCount === 0 ? 'No peers yet' : 
                     peerCount === 1 ? '1 peer connected' : 
                     `${peerCount} peers connected`;
    
    // Truncate filename
    let displayName = share.fileName || 'Share';
    if (displayName.length > 25) {
        displayName = displayName.slice(0, 22) + '...';
    }
    
    return `
        <div class="share-status-bar" data-drive-id="${share.driveId}" data-share-link="${share.shareLink}">
            <div class="share-status-info">
                <span class="share-status-name">${displayName}</span>
                <span class="share-status-peers">${peerText}</span>
            </div>
            <div class="share-status-actions">
                <button class="copy-link-btn" title="Copy link">Copy</button>
                <button class="share-status-view" onclick="switchTab('shares')">View</button>
                <button class="stop-pending-btn" title="Stop">✕</button>
            </div>
        </div>
    `;
}

// Create HTML for pending download - UNIFIED with upload structure
function createPendingDownloadHTML(driveId, download) {
    const shortLink = download.shareLink.replace('peardrop://', '').slice(0, 12) + '...';
    const displayName = download.shareName || 'Downloading...';
    const sizeText = download.totalBytes ? formatFileSize(download.totalBytes) : '—';
    
    let statusText = 'Connecting...';
    let indicatorClass = 'connecting';
    const isDownloading = download.status === 'downloading';
    const isComplete = download.status === 'complete';
    
    if (isDownloading) {
        indicatorClass = 'downloading';
    } else if (isComplete) {
        indicatorClass = 'complete';
    } else if (download.status === 'error') {
        statusText = download.error || 'Error';
        indicatorClass = 'error';
    } else if (download.status === 'cancelled') {
        statusText = 'Cancelled';
        indicatorClass = 'error';
    } else if (download.status === 'duplicate') {
        statusText = download.message || 'Already downloaded';
        indicatorClass = 'complete';
    } else if (download.status === 'moved') {
        // Special "Moved to Shares" notification - render differently
        return `
            <div class="transfer-item moved" data-drive-id="${driveId}" onclick="switchTab('shares')">
                <div class="moved-notification">
                    <span class="moved-text">✓ ${truncatedName}</span>
                    <span class="moved-link">${download.message || 'Moved to Shares →'}</span>
                </div>
            </div>
        `;
    }
    
    const percent = download.percent || 0;
    const speedText = download.speedFormatted || '—';
    const showProgress = isDownloading || isComplete;
    
    // Truncate long names
    let truncatedName = displayName;
    if (truncatedName.length > 30) {
        truncatedName = truncatedName.slice(0, 27) + '...';
    }
    
    const statusClass = isComplete ? 'complete' : (download.status === 'error' || download.status === 'cancelled') ? 'error' : '';
    
    return `
        <div class="transfer-item download ${statusClass}" data-drive-id="${driveId}">
            <div class="transfer-header">
                <div class="transfer-peer">
                    <div class="peer-indicator ${indicatorClass}"></div>
                    <span class="peer-name">⬇️ ${truncatedName}</span>
                </div>
                <div class="transfer-actions">
                    <span class="transfer-speed">${showProgress ? speedText : ''}</span>
                    <button class="minimize-download-btn" title="Hide from Home (continues in Shares)">−</button>
                    <button class="cancel-download-btn" title="Cancel and delete">✕</button>
                </div>
            </div>
            ${showProgress ? `
            <div class="transfer-progress">
                <div class="progress-bar" style="width: ${percent}%"></div>
            </div>
            <div class="transfer-stats">
                <span class="transfer-bytes">${download.bytesFormatted || '0 B'} / ${download.totalFormatted || sizeText}</span>
                <span class="transfer-percent">${Math.round(percent)}%</span>
            </div>
            ` : `
            <div class="transfer-info">
                <span class="transfer-status ${indicatorClass === 'error' ? 'error' : ''}">${statusText}</span>
            </div>
            `}
        </div>
    `;
}

// Update download UI without full re-render - UNIFIED with upload structure
function updateDownloadUI(driveId, download) {
    // Try both old and new selectors for backwards compatibility
    const item = transfersContainer.querySelector(`.transfer-blob[data-drive-id="${driveId}"]`) ||
                 transfersContainer.querySelector(`.transfer-item[data-drive-id="${driveId}"]`);
    if (!item) {
        renderTransfers();
        return;
    }
    
    const percent = download.percent || 0;
    
    // Update progress bar (support both old and new class names)
    const progressBar = item.querySelector('.blob-bar') || item.querySelector('.progress-bar');
    if (progressBar) {
        progressBar.style.width = `${percent}%`;
        progressBar.classList.remove('pulsing', 'indeterminate');
    }
    
    // Update status text (new blob) or bytes (old style)
    const statusEl = item.querySelector('.blob-status');
    if (statusEl && download.status === 'downloading') {
        const bytesFormatted = download.bytesFormatted || '0 B';
        const totalFormatted = download.totalFormatted || '—';
        statusEl.textContent = `${bytesFormatted} / ${totalFormatted}`;
    } else {
        // Old style fallback
        const bytesEl = item.querySelector('.transfer-bytes');
        if (bytesEl) {
            bytesEl.textContent = `${download.bytesFormatted || '0 B'} / ${download.totalFormatted || '—'}`;
        }
    }
    
    // Update right info (new blob) or percent (old style)
    const infoEl = item.querySelector('.blob-info');
    if (infoEl && download.status === 'downloading') {
        const speedText = download.speedFormatted ? `${download.speedFormatted} · ` : '';
        infoEl.textContent = `${speedText}${Math.round(percent)}%`;
    } else {
        const percentEl = item.querySelector('.transfer-percent');
        if (percentEl) {
            percentEl.textContent = `${Math.round(percent)}%`;
        }
    }
    
    // Update indicator class for state changes
    const indicator = item.querySelector('.blob-indicator') || item.querySelector('.peer-indicator');
    if (indicator) {
        indicator.classList.remove('waiting', 'connecting', 'downloading', 'active', 'complete', 'error');
        if (download.status === 'complete') {
            indicator.classList.add('complete');
            item.classList.add('blob-complete', 'complete');
        } else if (download.status === 'downloading') {
            indicator.classList.add('active');
            item.classList.remove('blob-connecting', 'blob-waiting');
            item.classList.add('blob-transferring');
        }
    }
}

// Stop pending share
async function stopPendingShare() {
    if (pendingShare) {
        // Clear auto-dismiss timer
        if (pendingShareTimer) {
            clearTimeout(pendingShareTimer);
            pendingShareTimer = null;
        }
        
        await window.electronAPI.hyperdriveStop({ 
            driveId: pendingShare.driveId, 
            purge: true 
        });
        pendingShare = null;
        currentShareLink = null;
        currentDriveId = null;
        renderTransfers();
        
        // Refresh Shares list
        loadDrives();
    }
}

// Create HTML for a single transfer item (uploads) - UNIFIED structure
function createTransferItemHTML(peerId, peer) {
    const isDownload = peerId === 'self';
    const statusClass = peer.complete ? 'complete' : '';
    const indicatorClass = peer.complete ? 'complete' : (isDownload ? 'downloading' : '');
    
    // For downloads, show file name if available; for uploads, show peer ID
    let headerName;
    if (isDownload) {
        headerName = peer.displayName || 'Downloading';
    } else {
        headerName = peer.displayName || `Peer ${peerId.slice(0, 6)}`;
    }
    
    // Truncate long names
    if (headerName.length > 30) {
        headerName = headerName.slice(0, 27) + '...';
    }
    
    const icon = isDownload ? '⬇️' : '⬆️';
    const percent = peer.percent || 0;
    
    return `
        <div class="transfer-item ${statusClass}" data-peer-id="${peerId}">
            <div class="transfer-header">
                <div class="transfer-peer">
                    <div class="peer-indicator ${indicatorClass}"></div>
                    <span class="peer-name">${icon} ${headerName}</span>
                </div>
                <span class="transfer-speed">${peer.speedFormatted || '—'}</span>
            </div>
            <div class="transfer-progress">
                <div class="progress-bar" style="width: ${percent}%"></div>
            </div>
            <div class="transfer-stats">
                <span class="transfer-bytes">${peer.bytesFormatted || '0 B'} / ${peer.totalFormatted || '—'}</span>
                <span class="transfer-percent">${Math.round(percent)}%</span>
            </div>
        </div>
    `;
}

// Update a single transfer item (without full re-render) - UNIFIED with downloads
function updateTransferUI(peerId, peer) {
    const item = transfersContainer.querySelector(`[data-peer-id="${peerId}"]`);
    if (item) {
        const percent = peer.percent || 0;
        
        // Support both old and new selectors
        const progressBar = item.querySelector('.blob-bar') || item.querySelector('.progress-bar');
        const statusEl = item.querySelector('.blob-status');
        const infoEl = item.querySelector('.blob-info');
        const percentEl = item.querySelector('.transfer-percent');
        const speedEl = item.querySelector('.transfer-speed');
        const bytesEl = item.querySelector('.transfer-bytes');
        
        // Handle unknown total (percent = -1) with animated/indeterminate style
        if (peer.percent < 0) {
            if (progressBar) {
                progressBar.style.width = '100%';
                progressBar.classList.add('pulsing', 'indeterminate');
            }
            if (infoEl) infoEl.textContent = '...';
            if (percentEl) percentEl.textContent = '...';
        } else {
            if (progressBar) {
                progressBar.style.width = `${percent}%`;
                progressBar.classList.remove('pulsing', 'indeterminate');
            }
            // Update new blob status
            if (statusEl) {
                statusEl.textContent = `${peer.bytesFormatted || '0 B'} / ${peer.totalFormatted || '—'}`;
            }
            if (infoEl) {
                const speedText = peer.speedFormatted ? `${peer.speedFormatted} · ` : '';
                infoEl.textContent = `${speedText}${Math.round(percent)}%`;
            }
            // Old style fallbacks
            if (percentEl) percentEl.textContent = `${Math.round(percent)}%`;
        }
        
        if (speedEl) speedEl.textContent = peer.speedFormatted || '—';
        if (bytesEl) bytesEl.textContent = `${peer.bytesFormatted || '0 B'} / ${peer.totalFormatted || '—'}`;
        
        if (peer.complete) {
            item.classList.add('blob-complete', 'complete');
            const indicator = item.querySelector('.blob-indicator') || item.querySelector('.peer-indicator');
            if (indicator) {
                indicator.classList.remove('waiting', 'active', 'downloading');
                indicator.classList.add('complete');
            }
        }
    } else {
        // Item doesn't exist, do full render
        renderTransfers();
    }
}

// ============================================================================
// Utilities
// ============================================================================

function formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function getFileIcon(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    const icons = {
        // Images
        jpg: '🖼️', jpeg: '🖼️', png: '🖼️', gif: '🖼️', webp: '🖼️', svg: '🖼️',
        // Videos
        mp4: '🎬', mov: '🎬', avi: '🎬', mkv: '🎬', webm: '🎬',
        // Audio
        mp3: '🎵', wav: '🎵', flac: '🎵', aac: '🎵', ogg: '🎵',
        // Documents
        pdf: '📕', doc: '📝', docx: '📝', txt: '📄', rtf: '📄',
        // Archives
        zip: '🗜️', rar: '🗜️', '7z': '🗜️', tar: '🗜️', gz: '🗜️',
        // Code
        js: '💻', ts: '💻', py: '💻', html: '💻', css: '💻', json: '💻',
        // Default
        default: '📄'
    };
    return icons[ext] || icons.default;
}

// ============================================================================
// Tab Navigation
// ============================================================================

tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
        const tabId = btn.dataset.tab;
        switchTab(tabId);
    });
});

function switchTab(tabId) {
    // Update buttons
    tabButtons.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tabId);
    });
    
    // Update pages
    homeTab.classList.toggle('active', tabId === 'home');
    sharesTab.classList.toggle('active', tabId === 'shares');
    
    // Load drives when switching to Shares tab
    if (tabId === 'shares') {
        loadDrives();
    }
}

// ============================================================================
// Shares Tab - DriveManager Integration
// ============================================================================

async function loadDrives() {
    try {
        const result = await window.electronAPI.drivesList();
        if (result.success) {
            drives = result.drives || [];
            renderDrives();
        }
    } catch (err) {
        console.error('Failed to load drives:', err);
    }
}

function renderDrives() {
    // Clear existing items (except empty state)
    const existingItems = sharesList.querySelectorAll('.download-item');
    existingItems.forEach(item => item.remove());
    
    // Show/hide empty state
    sharesEmpty.style.display = drives.length === 0 ? 'flex' : 'none';
    
    // Render each drive (newest first)
    const sortedDrives = [...drives].sort((a, b) => 
        new Date(b.createdAt) - new Date(a.createdAt)
    );
    
    sortedDrives.forEach(drive => {
        const item = createDriveItem(drive);
        sharesList.appendChild(item);
    });
}

function createDriveItem(drive) {
    const div = document.createElement('div');
    div.className = 'download-item';
    div.dataset.id = drive.id;
    
    // Check if currently downloading (cross-reference with pendingDownloads)
    const pendingDownload = pendingDownloads.get(drive.id);
    const isDownloading = drive.state === 'downloading' || pendingDownload?.status === 'downloading';
    
    // Check if currently uploading to peers (cross-reference with activePeers)
    const uploadingPeers = Array.from(activePeers.values()).filter(p => p.driveId === drive.id && !p.complete);
    const isUploading = uploadingPeers.length > 0;
    
    // Get the most advanced peer for progress display
    const uploadPeer = uploadingPeers.length > 0 
        ? uploadingPeers.reduce((best, p) => (p.percent > best.percent ? p : best), uploadingPeers[0])
        : null;
    
    // State: downloading, uploading, active (seeding), paused, local
    const isActive = drive.state === 'active';
    let statusClass, statusText;
    
    if (isDownloading) {
        statusClass = 'downloading';
        statusText = 'Downloading...';
    } else if (isUploading) {
        statusClass = 'uploading';
        statusText = `Uploading${uploadingPeers.length > 1 ? ` (${uploadingPeers.length} peers)` : ''}...`;
    } else if (isActive) {
        statusClass = 'seeding';
        statusText = 'Sharing';
    } else if (drive.state === 'paused') {
        statusClass = 'local';
        statusText = 'Paused';
    } else {
        statusClass = 'missing';
        statusText = 'Local Only';
    }
    
    // Get progress info if downloading or uploading
    const downloadPercent = pendingDownload?.percent || 0;
    const uploadPercent = uploadPeer?.percent || 0;
    const showDownloadProgress = isDownloading && downloadPercent > 0;
    const showUploadProgress = isUploading && uploadPercent > 0;
    const showProgress = showDownloadProgress || showUploadProgress;
    const percent = showDownloadProgress ? downloadPercent : uploadPercent;
    const speedText = showDownloadProgress 
        ? (pendingDownload?.speedFormatted || '') 
        : (uploadPeer?.speedFormatted || '');
    
    // Icon based on transfer direction
    const transferIcon = isDownloading ? '⬇️ ' : (isUploading ? '⬆️ ' : '');
    
    div.innerHTML = `
        <div class="download-item-header">
            <span class="download-item-name">${transferIcon}${drive.name || 'Unknown'}</span>
            <div class="download-item-menu-wrapper">
                <button class="download-item-menu-btn" title="Options">⋮</button>
                <div class="download-item-dropdown hidden">
                    <button class="dropdown-item" data-action="copy">Copy Link</button>
                    ${!isDownloading ? `<button class="dropdown-item" data-action="toggle">${isActive ? 'Pause' : 'Resume'}</button>` : ''}
                    <button class="dropdown-item" data-action="open">Show File</button>
                    <button class="dropdown-item danger" data-action="remove">${isDownloading ? 'Cancel' : 'Remove'}</button>
                </div>
            </div>
        </div>
        ${showProgress ? `
        <div class="transfer-progress" style="margin: 4px 0;">
            <div class="progress-bar" style="width: ${percent}%"></div>
        </div>
        ` : ''}
        <div class="download-item-meta">
            <span class="download-item-size">${formatFileSize(drive.totalBytes)}</span>
            <span class="download-item-status ${statusClass}">${statusText}${showProgress ? ` ${Math.round(percent)}%` : ''}${speedText ? ` · ${speedText}` : ''}</span>
            ${drive.stats?.peers > 0 && !isUploading ? `<span class="download-item-peers">${drive.stats.peers} peers</span>` : ''}
        </div>
    `;
    
    // Menu toggle
    const menuBtn = div.querySelector('.download-item-menu-btn');
    const dropdown = div.querySelector('.download-item-dropdown');
    
    menuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        // Close other open dropdowns
        document.querySelectorAll('.download-item-dropdown').forEach(d => {
            if (d !== dropdown) d.classList.add('hidden');
        });
        dropdown.classList.toggle('hidden');
    });
    
    // Close dropdown when clicking outside
    document.addEventListener('click', () => {
        dropdown.classList.add('hidden');
    });
    
    // Add event listeners for dropdown items
    div.querySelectorAll('.dropdown-item').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            dropdown.classList.add('hidden');
            handleDriveAction(drive.id, btn.dataset.action, drive);
        });
    });
    
    return div;
}

async function handleDriveAction(id, action, drive = null) {
    // Find drive if not passed
    if (!drive) {
        drive = drives.find(d => d.id === id);
    }
    
    try {
        switch (action) {
            case 'copy':
                if (drive?.shareLink) {
                    await navigator.clipboard.writeText(drive.shareLink);
                    console.log('Link copied:', drive.shareLink);
                }
                break;
                
            case 'toggle':
                if (drive) {
                    const isActive = drive.state === 'active';
                    const result = isActive 
                        ? await window.electronAPI.drivesPause({ id })
                        : await window.electronAPI.drivesResume({ id });
                    
                    if (result.success) {
                        drive.state = isActive ? 'paused' : 'active';
                        renderDrives();
                    }
                }
                break;
                
            case 'open':
                await window.electronAPI.openDownloads();
                break;
                
            case 'remove':
                if (confirm('Remove this share? The hyperdrive data will be deleted.')) {
                    const result = await window.electronAPI.drivesRemove({ id, deleteFiles: false });
                    if (result.success) {
                        drives = drives.filter(d => d.id !== id);
                        renderDrives();
                    }
                }
                break;
        }
    } catch (err) {
        console.error('Drive action failed:', err);
    }
}

// Listen for drive updates from main process
window.electronAPI.onDrivesUpdated((event, data) => {
    console.log('Drives updated:', data);
    
    if (data.action === 'added') {
        // Add to beginning of list
        drives.unshift(data.entry);
        if (sharesTab.classList.contains('active')) {
            renderDrives();
        }
    } else if (data.action === 'removed') {
        drives = drives.filter(d => d.id !== data.id);
        if (sharesTab.classList.contains('active')) {
            renderDrives();
        }
    } else if (data.action === 'updated') {
        const idx = drives.findIndex(d => d.id === data.entry.id);
        if (idx >= 0) {
            drives[idx] = data.entry;
            if (sharesTab.classList.contains('active')) {
                renderDrives();
            }
        }
    }
});

// ============================================================================
// Initialize
// ============================================================================

// Load drives on startup
loadDrives();

console.log('PearDrop initialized');
