#!/usr/bin/env node
/**
 * Test folder sharing via PearDrop
 * Usage: node test-share-folder.js <folder-path>
 */

const { manager } = require('./lib/hyperdrive-manager');
const fs = require('fs').promises;
const path = require('path');

async function enumerateFolder(folderPath, basePath = null, folderName = null) {
  basePath = basePath || folderPath;
  folderName = folderName || path.basename(folderPath);
  const results = [];
  const entries = await fs.readdir(folderPath, { withFileTypes: true });
  
  for (const entry of entries) {
    const entryPath = path.join(folderPath, entry.name);
    if (entry.isFile()) {
      const stat = await fs.stat(entryPath);
      // Calculate relative path from the root folder being shared
      const relPath = path.relative(basePath, entryPath);
      // Prepend folder name so structure is: folderName/subdir/file.txt
      const relativePath = path.join(folderName, relPath);
      results.push({
        path: entryPath,
        name: entry.name,
        relativePath: relativePath,
        size: stat.size
      });
    } else if (entry.isDirectory()) {
      // Recurse into subdirectories
      const subFiles = await enumerateFolder(entryPath, basePath, folderName);
      results.push(...subFiles);
    }
  }
  
  return results;
}

async function main() {
  const folderPath = process.argv[2];
  
  if (!folderPath) {
    console.error('Usage: node test-share-folder.js <folder-path>');
    process.exit(1);
  }
  
  const stat = await fs.stat(folderPath);
  if (!stat.isDirectory()) {
    console.error('Not a folder:', folderPath);
    process.exit(1);
  }
  
  console.log('Scanning folder:', folderPath);
  const files = await enumerateFolder(folderPath);
  console.log('Found', files.length, 'files:');
  files.forEach(f => console.log(' -', f.relativePath, `(${f.size} bytes)`));
  
  // Initialize manager
  await manager.init();
  
  // Create share
  const folderName = path.basename(folderPath);
  const result = await manager.createDrive(files, {
    name: folderName
  });
  
  console.log('\n===========================================');
  console.log('SHARE LINK:', result.shareLink);
  console.log('===========================================\n');
  console.log('Share active. Press Ctrl+C to stop.\n');
  
  // Keep alive and log events
  manager.on('peer-connected', (data) => {
    console.log('>>> PEER CONNECTED:', data);
  });
  
  manager.on('peer-disconnected', (data) => {
    console.log('>>> PEER DISCONNECTED:', data);
  });
  
  manager.on('upload-progress', (data) => {
    console.log(`>>> UPLOAD: ${data.percent}%`);
  });
  
  manager.on('upload-complete', (data) => {
    console.log('>>> UPLOAD COMPLETE:', data);
  });
  
  // Handle shutdown
  process.on('SIGINT', async () => {
    console.log('\nStopping share...');
    await manager.stopDrive(result.driveId, { purge: true });
    console.log('Done');
    process.exit(0);
  });
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
