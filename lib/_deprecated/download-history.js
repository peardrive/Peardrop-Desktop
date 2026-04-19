/**
 * MODULE: lib/download-history.js
 * PURPOSE: Persistent download history and seeding state management
 * 
 * EXPORTS:
 *   - DownloadHistory (class)
 *     - init() - Load history from disk
 *     - add(download) - Add completed download
 *     - update(id, updates) - Update download state
 *     - remove(id) - Remove from history
 *     - getAll() - Get all downloads
 *     - getSeeding() - Get downloads marked for seeding
 *     - setSeeding(id, isSeeding) - Toggle seeding state
 *     - checkLocalFiles() - Verify local files still exist
 * 
 * STORAGE: ~/peardrop/download-history.json
 * 
 * EXTERNAL CALLS: fs.promises, path
 * KEY STATE: downloads Map, persisted to JSON
 */

const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const { EventEmitter } = require('events');

const PEARDROP_DIR = path.join(os.homedir(), 'peardrop');
const HISTORY_FILE = path.join(PEARDROP_DIR, 'download-history.json');

/**
 * Download entry structure:
 * {
 *   id: string,              // Unique ID (driveId or generated)
 *   shareLink: string,       // Original peardrop:// link
 *   shareName: string,       // Display name
 *   files: Array<{name, path, size}>,
 *   totalBytes: number,
 *   downloadedAt: string,    // ISO timestamp
 *   localPath: string,       // Where files are saved
 *   isSeeding: boolean,      // Currently sharing to others
 *   isLocalAvailable: boolean, // Files still exist locally
 *   driveKey: string,        // Hyperdrive key for reseeding
 *   seedStats: {             // Seeding statistics
 *     uploaded: number,
 *     peers: number
 *   }
 * }
 */

class DownloadHistory extends EventEmitter {
    constructor() {
        super();
        this.downloads = new Map();
        this.initialized = false;
    }

    /**
     * Initialize - load history from disk
     */
    async init() {
        if (this.initialized) return;

        try {
            await fs.mkdir(PEARDROP_DIR, { recursive: true });
            
            const data = await fs.readFile(HISTORY_FILE, 'utf8');
            const parsed = JSON.parse(data);
            
            if (Array.isArray(parsed.downloads)) {
                for (const download of parsed.downloads) {
                    this.downloads.set(download.id, download);
                }
            }
            
            console.log('[DownloadHistory] Loaded', this.downloads.size, 'downloads');
        } catch (err) {
            if (err.code !== 'ENOENT') {
                console.error('[DownloadHistory] Error loading:', err.message);
            }
            // Start fresh if file doesn't exist or is corrupted
        }

        this.initialized = true;
    }

    /**
     * Save history to disk
     */
    async _save() {
        try {
            const data = {
                version: 1,
                updatedAt: new Date().toISOString(),
                downloads: Array.from(this.downloads.values())
            };
            await fs.writeFile(HISTORY_FILE, JSON.stringify(data, null, 2));
        } catch (err) {
            console.error('[DownloadHistory] Error saving:', err.message);
        }
    }

    /**
     * Add a completed download to history
     */
    async add(download) {
        if (!this.initialized) await this.init();

        const entry = {
            id: download.id || `download_${Date.now()}`,
            shareLink: download.shareLink,
            shareName: download.shareName || 'Unknown',
            files: download.files || [],
            totalBytes: download.totalBytes || 0,
            downloadedAt: new Date().toISOString(),
            localPath: download.localPath,
            isSeeding: download.isSeeding !== false, // Default to true
            isLocalAvailable: true,
            driveKey: download.driveKey,
            seedStats: {
                uploaded: 0,
                peers: 0
            }
        };

        this.downloads.set(entry.id, entry);
        await this._save();
        
        this.emit('added', entry);
        console.log('[DownloadHistory] Added:', entry.shareName);
        
        return entry;
    }

    /**
     * Update a download entry
     */
    async update(id, updates) {
        if (!this.initialized) await this.init();

        const existing = this.downloads.get(id);
        if (!existing) return null;

        const updated = { ...existing, ...updates };
        this.downloads.set(id, updated);
        await this._save();
        
        this.emit('updated', updated);
        return updated;
    }

    /**
     * Remove a download from history
     */
    async remove(id) {
        if (!this.initialized) await this.init();

        const existing = this.downloads.get(id);
        if (!existing) return false;

        this.downloads.delete(id);
        await this._save();
        
        this.emit('removed', id);
        console.log('[DownloadHistory] Removed:', id);
        
        return true;
    }

    /**
     * Get all downloads
     */
    async getAll() {
        if (!this.initialized) await this.init();
        return Array.from(this.downloads.values());
    }

    /**
     * Get downloads marked for seeding
     */
    async getSeeding() {
        if (!this.initialized) await this.init();
        return Array.from(this.downloads.values())
            .filter(d => d.isSeeding && d.isLocalAvailable);
    }

    /**
     * Toggle seeding state for a download
     */
    async setSeeding(id, isSeeding) {
        return this.update(id, { isSeeding });
    }

    /**
     * Check which downloads still have local files available
     */
    async checkLocalFiles() {
        if (!this.initialized) await this.init();

        let changed = false;
        
        for (const [id, download] of this.downloads) {
            let available = false;
            
            // Check if any of the files exist
            for (const file of download.files) {
                try {
                    await fs.access(file.path);
                    available = true;
                    break;
                } catch {
                    // File doesn't exist
                }
            }
            
            if (download.isLocalAvailable !== available) {
                download.isLocalAvailable = available;
                changed = true;
                console.log('[DownloadHistory] Local availability changed:', 
                    download.shareName, available ? 'available' : 'missing');
            }
        }

        if (changed) {
            await this._save();
        }

        return Array.from(this.downloads.values());
    }

    /**
     * Update seed stats for a download
     */
    async updateSeedStats(id, stats) {
        const existing = this.downloads.get(id);
        if (!existing) return null;

        existing.seedStats = { ...existing.seedStats, ...stats };
        this.downloads.set(id, existing);
        // Don't save on every stat update - too frequent
        
        this.emit('stats-updated', existing);
        return existing;
    }

    /**
     * Get download by share link
     */
    async getByShareLink(shareLink) {
        if (!this.initialized) await this.init();
        
        for (const download of this.downloads.values()) {
            if (download.shareLink === shareLink) {
                return download;
            }
        }
        return null;
    }
}

// Singleton instance
const history = new DownloadHistory();

module.exports = {
    DownloadHistory,
    history
};
