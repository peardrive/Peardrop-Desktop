#!/usr/bin/env node
/**
 * Minimal test: Can Hyperswarm connect at all?
 * Run two instances to test P2P connectivity
 */

const Hyperswarm = require('hyperswarm')
const crypto = require('crypto')

const topic = process.argv[2] 
  ? Buffer.from(process.argv[2], 'hex')
  : crypto.randomBytes(32)

console.log('Topic:', topic.toString('hex'))
console.log('Mode:', process.argv[3] || 'both (server + client)')

const swarm = new Hyperswarm()

swarm.on('connection', (socket, peerInfo) => {
  console.log('>>> CONNECTED to peer!', peerInfo?.publicKey?.toString('hex')?.slice(0, 12))
  
  socket.on('data', data => {
    console.log('Received:', data.toString())
  })
  
  socket.write('Hello from ' + process.pid)
  
  socket.on('close', () => {
    console.log('Peer disconnected')
  })
})

async function main() {
  console.log('Joining swarm...')
  
  const discovery = swarm.join(topic, { 
    server: true, 
    client: true 
  })
  
  await discovery.flushed()
  console.log('Flushed - announced on DHT')
  
  await swarm.flush()
  console.log('Swarm flushed - ready for connections')
  
  console.log('\nWaiting for peers... (Ctrl+C to exit)')
  console.log('To test: run another instance with same topic:')
  console.log(`  node test-swarm.js ${topic.toString('hex')}`)
}

main().catch(console.error)
