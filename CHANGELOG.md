# PearDrop Changelog

## v0.18.0 (2026-03-10) - V2 UI Migration 🎉

**Major UI overhaul: Integrated ScrollList + DriveItem architecture**

### What Changed
- **New modular UI architecture**
  - ScrollList v2: Slot-based container (child components own their blocks)
  - DriveItem v1.0: Self-contained drive display with built-in context menu
  - DriveActions: Bridge between UI actions and system APIs
  - All components work standalone (see `lib/*/standalone.html`)
  
- **New features**
  - Tab header with 3-dots menu (Pause All, Resume All, Clear Completed)
  - Sort By submenu: Manual Edit, Recent, Status, Size, Name, Peers, File Type
  - Ascending/descending toggle (click same sort to flip)
  - Manual reorder mode with FLIP animations
  - New downloads appear at top of list

- **Debug system**
  - Centralized logging via `lib/logger.js`
  - Runtime toggle: `peardrop.setDebug(true/false)` in DevTools
  - Config persisted to `~/peardrop/config.json`
  - Stays ON during development, easy to disable for users

- **Cross-platform support**
  - macOS: Full glassmorphism, hidden title bar, vibrancy
  - Windows/Linux: Standard title bar, solid background
  - All lib/ components portable to Pear runtime

- **Architecture documentation**
  - `lib/ARCHITECTURE.md`: Slot-based composition, action handling layers
  - `ARCHITECTURE.md`: UI stacking context rules (critical for menus!)
  - All modules have complete header manifests

### Migration Notes
- v1 files backed up: `main-v1.js`, `renderer-v1.js`, `index-v1.html`
- Run with: `npm start` or `npm run dev`
- Config at: `~/peardrop/config.json`

---

## v0.17.2 (2026-02-25) - Cleanup & Audit
- 🐛 **Fixed `historyEntry is not defined`** - Renamed to `driveEntry` after refactor
- 🐛 **Fixed missing closing brace** on `cancelAndDeleteDownload()` that broke all JS
- 🧹 **Moved deprecated files** to `lib/_deprecated/`:
  - `download-history.js` (replaced by drive-manager.js)
  - `drive-dedup.js` (dedup now built into main.js)
- 📋 **Updated main.js manifest** with current IPC structure
- ✅ **Full 20-point audit** - No remaining errors found
- 📚 **Added ENGINEERING-PRINCIPLES.md Rule #9** - Verification before commit
- 📚 **Added POST-EDIT VERIFICATION section** to CLAUDE.md

## v0.17.1 (2026-02-25)
- 🎨 **Downloads show in BOTH Home + Shares simultaneously**
  - Progress visible in both tabs during download
  - Shares tab shows "⬇️ Downloading..." with progress bar
- ➖ **Minimize button (−)** on downloads
  - Hides from Home but continues in Shares
  - Good for decluttering while download runs
- ✕ **Cancel button now confirms and fully deletes**
  - Shows "Cancel and delete permanently?" confirmation
  - Actually removes drive, storage, and files
- 🔄 State synced between Home and Shares in real-time

## v0.17.0 (2026-02-25) - DriveManager Unification 🎯
**Major refactor: Single source of truth for all drives**

### What Changed
- **New `DriveManager` module** (`lib/drive-manager.js`)
  - Replaces both `download-history.js` AND the manifest tracking in `hyperdrive-manager.js`
  - One JSON file: `~/peardrop/drives.json`
  - Clean API: `add()`, `remove()`, `pause()`, `resume()`, `get()`, `getAll()`, `getByKey()`
  
- **New IPC API**:
  - `drives-list` → Get all drives
  - `drives-pause` → Stop seeding (keep data)
  - `drives-resume` → Resume seeding
  - `drives-remove` → Delete completely (drive + optional files)
  - `drives-check-files` → Verify local files exist

### Why
- Previous system had TWO parallel trackers (manifest + download-history) that diverged
- Now: **If it's in the Shares list, it exists. If you remove it, it's gone.**
- Universal module for future tools (mobile, CLI, etc.)

### Breaking Changes
- `download-history.json` is deprecated (new data in `drives.json`)
- Old history entries won't auto-migrate - start fresh

---

## v0.16.3 (2026-02-25)
- 📜 **Clear logging when removing shares**
  - Now logs: "Removing share from history", "Stopping active share" / "Cleaned up inactive drive storage", "Share removed completely"
  - User can verify in logs that drive is fully cleaned up
- 🧹 **Storage cleanup for inactive drives**
  - Previously only stopped drives if in activeDrives (fails after app restart)
  - Now always cleans up drive storage directory when removing from Shares

## v0.16.2 (2026-02-25)
- 🐛 **Fixed "Clear" button destroying active shares**
  - Root cause: `clearFiles()` was calling `hyperdriveStop(purge: true)` 
  - Fix: Clear button now only resets dropzone UI, drive keeps seeding
  - Shares remain active and visible in Shares tab
- 🔄 **Shares tab now refreshes when upload completes**
  - `showMovedToShares()` now calls `loadDownloadHistory()` to update list

## v0.16.1 (2026-02-25)
- 📊 **Minimal share status bar**: Pending shares now show as a compact bar
  - Shows filename + peer count + Copy/View/Stop buttons
  - Much cleaner than full block, doesn't overwhelm Home
  - Full progress only shows when someone is actively downloading

## v0.16.0 (2026-02-25)
- 🔄 **Improved upload UX flow**:
  - Shares now added to Shares tab immediately when created
  - After peer finishes downloading: "Complete ✓" for 2 sec → fades out
  - Shows clickable "Moved to Shares →" notification
  - Home stays clean, all shares managed in Shares tab
- 📜 **Fixed Shares tab scrolling**: Added native rubber-band bounce scroll
- ✨ New animations for transfer completion and "moved" state

## v0.15.2 (2026-02-25)
- 🐛 **Fixed "Copy Link" returning "peardrop://unknown"**
  - Root cause: `openDrive()` wasn't saving `shareLink` to session object
  - Fix: Added `shareLink` and `metadata.key` to session in hyperdrive-manager.js

## v0.15.1 (2026-02-25)
- 🎨 **Cleaner Shares tab UI**:
  - Removed emojis from tab names ("Home", "Shares")
  - Consolidated action buttons into 3-dot dropdown menu
  - Renamed "Stop Seeding" → "Pause", "Open" → "Show File"
  - Added "Copy Link" option to share dropdown
- 📋 Status labels simplified: "Sharing", "Local", "File Missing"

## v0.15.0 (2026-02-25)
- 🔍 **Duplicate Detection**: Recognizes previously downloaded drives by key
  - Shows "Already have this file" if local file exists
  - Offers re-download if file was deleted
  - Uses drive key (content hash) - works even if file renamed
- 📤 **"Downloads" tab renamed to "Shares"**: Shows all active hyperdrives
- 📦 **lib/drive-dedup.js**: New module for deduplication + local file verification
- 🔧 Tab IDs updated: `downloadsTab` → `sharesTab`, etc.

## v0.14.1 (2026-02-25)
- 🎨 **UNIFIED PROGRESS UI**: Upload and download now use identical HTML structure
  - Fixed: Download progress bar was fully green (nested `.progress-fill` bug)
  - Fixed: Download text size inconsistency (`.transfer-stats` missing CSS)
  - All transfers now use: `.progress-bar` with width %, `.transfer-stats` with `.transfer-bytes` + `.transfer-percent`
- 📦 **lib/transfer-ui.js**: New module for reusable progress components (future mobile use)
- 📝 Documentation: Added "UNIFIED PROGRESS UI" section to CLAUDE.md

## v0.14.0 (2026-02-24)
- 🆕 **Download History Tab**: Swipe between Home and Downloads
- 🌱 **Seeding Support**: Downloaded files can be re-shared to others
- 📥 **Persistent Downloads**: Downloads stay active until you stop them
- 🔄 **P2P Relay**: If uploader goes offline, peers who downloaded can serve the file
- 📋 **lib/download-history.js**: New module for persistent history storage

## v0.13.0 (2026-02-24)
- 🏗️ **REFACTOR: Modular architecture**
  - `lib/downloader.js` - Download orchestration (✅ SAFE to modify)
  - `lib/file-utils.js` - Pure file utilities (✅ SAFE to modify)
  - `main.js` - Now thin IPC routing only
- 🔒 Sacred code clearly marked in imports
- 📦 Ready for mobile port (download logic is now portable)

## v0.12.0 (2026-02-24)
- ✅ Duplicate file handling: `file.txt` → `file (1).txt` like macOS
- ✅ "Sender went offline" detection and error message
- ✅ Unified download block UI (connecting → progress in same block)
- ✅ Folder structure preserved in downloads
- ✅ Cancel button works during download
- ✅ Error resilience (one file fails, others continue)

## v0.11.0 (2026-02-24)
- ✅ Folder sharing support
- ✅ Cancel download functionality
- ✅ 30s refresh loop for peer discovery
- ✅ Abort connection support

## v0.10.0 (2026-02-22)
- ✅ Core P2P sharing working
- ✅ Upload/download progress tracking
- ✅ Manifest system for file metadata
- ✅ CLI tool (peardrop share/download/list/stop)
- ✅ Glassmorphism UI

---

## Versioning Strategy

**Format:** `0.MAJOR.MINOR`
- Pre-1.0: Still in active development
- MAJOR: Significant feature additions
- MINOR: Bug fixes, small improvements

**Archives:** `~/Apps/peardrop-versions/v0.XX.X.zip`

Keep working versions archived so you can roll back if needed.
