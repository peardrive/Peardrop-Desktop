#!/usr/bin/env node
/**
 * Quick test script for PearDrop sharing
 * Usage: node test-share.js <file-path>
 */

const { manager } = require('./lib/hyperdrive-manager');
const fs = require('fs').promises;
const path = require('path');

async function main() {
  const filePath = process.argv[2] || path.join(__dirname, 'package.json');
  
  console.log('Testing PearDrop share with:', filePath);
  
  // Check file exists
  const stat = await fs.stat(filePath);
  console.log('File size:', stat.size, 'bytes');
  
  // Initialize manager
  await manager.init();
  
  // Create share
  const result = await manager.createDrive([{
    path: filePath,
    name: path.basename(filePath),
    size: stat.size
  }], {
    name: 'Test Share'
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
    console.log(`>>> UPLOAD: ${data.percent}% (${data.speed})`);
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
