# DriveItem Test Harness

Test DriveItem component with **real** hyperdrive downloads, not simulated data.

## Purpose

- Verifies DriveItem works correctly with actual P2P operations
- Uses exact same IPC events and data flow as main PearDrop app
- Isolates testing to just the DriveItem component
- No risk of breaking main app while iterating

## Usage

From the **parent peardrop directory** (uses its node_modules):

```bash
cd ~/Apps/peardrop

# Run with a peardrop link
npx electron test-drive-item peardrop://abc123...

# Or use the helper script
./test-drive-item/run.sh peardrop://abc123...
```

## What It Tests

1. **Connecting** - Initial state, finding peers
2. **Downloading** - Progress bar, speed, peer count
3. **Complete** - Final state after download

## IPC Events Tested

Same as main app:
- `hyperdrive-open` → Connect to remote drive
- `hyperdrive-download` → Download files
- `peer-connected` / `peer-disconnected`
- `upload-progress` (with `peerId: 'self'` for downloads)
- `files-downloaded`

## Debugging

Open DevTools:
```bash
NODE_ENV=development npx electron test-drive-item peardrop://...
```

Watch the status log in the window + console output for events.
