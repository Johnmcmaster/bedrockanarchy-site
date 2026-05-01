const bedrock = require('bedrock-protocol')

const HOST = 'bedrockanarchy.org'
const PORT = 19132
const STAGGER_MS = 1500  // delay between each bot connecting

const NAMES = [
  'xX_Vortex_Xx', 'SniperzKing99', 'DarkReaper2007', 'CreeperSlayer42',
  'NightWolf_303', 'BlazeFire77', 'ShadowStrike21', 'IceDagger_YT',
  'xXProGamer69Xx', 'ChaosRuler', 'VenomFang88', 'SwiftBlade_1',
  'DemonHunter404', 'StormBreaker_X', 'GhostRider999', 'ToxicSniper_YT',
  'LegendKiller45', 'RedWolf2012', 'DarkStar_Pro', 'ZeroGrav_TV'
]

const BOT_COUNT = NAMES.length

function spawnBot(index) {
  const username = NAMES[index]

  const client = bedrock.createClient({
    host: HOST,
    port: PORT,
    username,
    version: '26.10',
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
