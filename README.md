# PearDrop

Simple, elegant P2P file sharing.

## What It Does

**SHARE** — Drop files, get a link. Anyone with the link can download.

**DOWNLOAD** — Paste a link, get the files.

That's it.

## Getting Started

```bash
npm install
npm run dev
```

## How It Works

- Uses Hyperdrive for P2P file transfer
- No accounts, no servers, no tracking
- Files transfer directly between peers
- Data is purged after sharing ends

## Link Format

```
peardrop://[64-character-hex-key]
```

## Storage

```
~/peardrop/
├── drives/           # Temporary drive storage (auto-cleaned)
├── drives-manifest.json
└── downloads/        # Downloaded files
```

## Architecture

- `main.js` — Electron main process
- `renderer.js` — UI logic
- `lib/hyperdrive-manager.js` — Hyperdrive lifecycle & cleanup

## License

MIT
