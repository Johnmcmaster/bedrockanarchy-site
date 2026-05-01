const bedrock = require('bedrock-protocol')

const HOST = 'bedrockanarchy.org'
const PORT = 19132
const BOT_COUNT = 10
const STAGGER_MS = 1500  // delay between each bot connecting

function spawnBot(index) {
  const username = `AnarBot${index}`

  const client = bedrock.createClient({
    host: HOST,
    port: PORT,
    username,
    version: '1.21.2',
    offline: true  // set to false and add auth if server requires Xbox Live login
  })

  client.on('spawn', () => {
    console.log(`[${username}] spawned`)
  })

  client.on('disconnect', ({ message }) => {
    console.log(`[${username}] disconnected: ${message}`)
  })

  client.on('error', err => {
    console.error(`[${username}] error: ${err.message}`)
  })
}

for (let i = 0; i < BOT_COUNT; i++) {
  setTimeout(() => spawnBot(i), i * STAGGER_MS)
}
