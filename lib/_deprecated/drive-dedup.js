/**
 * MODULE: drive-dedup.js
 * PURPOSE: Detect duplicate hyperdrives, verify local files exist for sharing
 * 
 * EXPORTS:
 *   - checkBeforeDownload(driveKey, historyModule) - Check if drive already downloaded
 *   - verifyLocalFiles(historyEntry) - Check if local files still exist
 *   - parsedriveKey(shareLink) - Extract drive key from peardrop:// link
 *   - auditAllShares(historyModule) - Update status of all history entries
 * 
 * DESIGN:
 *   - Uses drive key (from link) as unique identifier - already a content hash
 *   - Fast checks: key lookup + fs.existsSync (~1-2ms total)
 *   - Graceful fallback: if check fails, allow download anyway
 *   - No modification to core download logic
 * 
 * DEPENDENCIES:
 *   - fs (file existence checks)
 *   - path (path operations)
 * 
 * USAGE:
 *   const dedup = require('./lib/drive-dedup');
 *   const result = await dedup.checkBeforeDownload(driveKey, downloadHistory);
 *   if (result.exists && result.localStatus === 'valid') {
 *     // Already have this, show existing
 *   } else if (result.exists && result.localStatus === 'missing') {
 *     // Had it but files deleted, offer re-download
 *   } else {
 *     // New download, proceed normally
 *   }
 */

const fs = require('fs');
const path = require('path');

/**
 * Extract drive key from a peardrop:// link
 * @param {string} shareLink - Full share link (peardrop://abc123...)
 * @returns {string|null} Drive key or null if invalid
 */
function parseDriveKey(shareLink) {
    if (!shareLink || typeof shareLink !== 'string') return null;
    
    // Remove protocol prefix
    const key = shareLink.replace('peardrop://', '').trim();
    
    // Basic validation - should be hex string of reasonable length
    if (key.length < 32 || !/^[a-f0-9]+$/i.test(key)) {
        return null;
    }
    
    return key.toLowerCase();
}

/**
 * Check if a drive has already been downloaded
 * @param {string} driveKey - The drive's public key (hex)
 * @param {object} historyModule - Download history module with getAll()
 * @returns {Promise<{exists: boolean, historyEntry: object|null, localStatus: 'valid'|'missing'|'partial'|null}>}
 */
async function checkBeforeDownload(driveKey, historyModule) {
    const result = {
        exists: false,
        historyEntry: null,
        localStatus: null
    };
    
    if (!driveKey || !historyModule) {
        return result;
    }
    
    try {
        // Get all history entries
        const allDownloads = await historyModule.getAll();
        
        // Find entry with matching drive key
        // The key might be stored as 'id', 'driveKey', or extractable from shareLink
        const entry = allDownloads.find(d => {
            // Check direct id match
            if (d.id && d.id.toLowerCase() === driveKey.toLowerCase()) {
                return true;
            }
            // Check driveKey field
            if (d.driveKey && d.driveKey.toLowerCase() === driveKey.toLowerCase()) {
                return true;
            }
            // Extract from shareLink
            if (d.shareLink) {
                const linkKey = parseDriveKey(d.shareLink);
                if (linkKey && linkKey === driveKey.toLowerCase()) {
                    return true;
                }
            }
            return false;
        });
        
        if (!entry) {
            return result;
        }
        
        result.exists = true;
        result.historyEntry = entry;
        
        // Verify local files
        const verification = await verifyLocalFiles(entry);
        result.localStatus = verification.status;
        
        return result;
        
    } catch (error) {
        console.error('[DriveDedup] Check failed:', error.message);
        // Graceful fallback - allow download if check fails
        return result;
    }
}

/**
 * Verify that local files for a history entry still exist
 * @param {object} historyEntry - Entry from download history
 * @returns {Promise<{status: 'valid'|'missing'|'partial', existingFiles: string[], missingFiles: string[]}>}
 */
async function verifyLocalFiles(historyEntry) {
    const result = {
        status: 'missing',
        existingFiles: [],
        missingFiles: []
    };
    
    if (!historyEntry) {
        return result;
    }
    
    try {
        // Check localPath if available
        if (historyEntry.localPath) {
            if (fs.existsSync(historyEntry.localPath)) {
                // Check if it's the expected size (quick sanity check)
                const stats = fs.statSync(historyEntry.localPath);
                
                // If we have expected size, verify it roughly matches
                if (historyEntry.totalBytes) {
                    // Allow 1% variance for filesystem overhead
                    const sizeDiff = Math.abs(stats.size - historyEntry.totalBytes);
                    const threshold = historyEntry.totalBytes * 0.01;
                    
                    if (stats.isDirectory() || sizeDiff <= threshold || stats.size >= historyEntry.totalBytes) {
                        result.status = 'valid';
                        result.existingFiles.push(historyEntry.localPath);
                    } else {
                        result.status = 'partial';
                        result.existingFiles.push(historyEntry.localPath);
                    }
                } else {
                    // No size info, assume valid if exists
                    result.status = 'valid';
                    result.existingFiles.push(historyEntry.localPath);
                }
            } else {
                result.missingFiles.push(historyEntry.localPath);
            }
        }
        
        // If entry has files array, check each
        if (historyEntry.files && Array.isArray(historyEntry.files)) {
            for (const file of historyEntry.files) {
                const filePath = file.localPath || file.path;
                if (filePath && fs.existsSync(filePath)) {
                    result.existingFiles.push(filePath);
                } else if (filePath) {
                    result.missingFiles.push(filePath);
                }
            }
            
            // Determine status based on files
            if (result.missingFiles.length === 0 && result.existingFiles.length > 0) {
                result.status = 'valid';
            } else if (result.existingFiles.length > 0 && result.missingFiles.length > 0) {
                result.status = 'partial';
            } else if (result.missingFiles.length > 0) {
                result.status = 'missing';
            }
        }
        
        return result;
        
    } catch (error) {
        console.error('[DriveDedup] Verify failed:', error.message);
        return result;
    }
}

/**
 * Audit all shares and update their local status
 * Useful for startup or periodic checks
 * @param {object} historyModule - Download history module
 * @returns {Promise<{total: number, valid: number, missing: number, partial: number}>}
 */
async function auditAllShares(historyModule) {
    const stats = { total: 0, valid: 0, missing: 0, partial: 0 };
    
    if (!historyModule) {
        return stats;
    }
    
    try {
        const allDownloads = await historyModule.getAll();
        stats.total = allDownloads.length;
        
        for (const entry of allDownloads) {
            const verification = await verifyLocalFiles(entry);
            
            switch (verification.status) {
                case 'valid':
                    stats.valid++;
                    break;
                case 'partial':
                    stats.partial++;
                    break;
                case 'missing':
                    stats.missing++;
                    break;
            }
            
            // Update entry's localStatus if the history module supports it
            if (historyModule.updateStatus && entry.localStatus !== verification.status) {
                try {
                    await historyModule.updateStatus(entry.id, verification.status);
                } catch (e) {
                    // Ignore update errors
                }
            }
        }
        
        console.log(`[DriveDedup] Audit complete: ${stats.valid} valid, ${stats.partial} partial, ${stats.missing} missing`);
        return stats;
        
    } catch (error) {
        console.error('[DriveDedup] Audit failed:', error.message);
        return stats;
    }
}

module.exports = {
    parseDriveKey,
    checkBeforeDownload,
    verifyLocalFiles,
    auditAllShares
};
