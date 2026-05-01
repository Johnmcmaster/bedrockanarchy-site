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

const MESSAGES = [
  'anyone here?', 'lol', 'this server is crazy', 'just joined',
  'where is everyone', 'good server ngl', 'bro what', 'lmao',
  'gg', 'lets gooo', 'anyone got food', 'this is wild',
  'fr fr', 'no way', 'how long has this server been up',
  'this is actually fun', 'hello?', 'rip my stuff', 'insane',
  'okay then', 'yoo', 'bruh', 'what just happened', 'lol nice'
]

const BOT_COUNT = NAMES.length
const CHAT_MIN_MS = 20000   // minimum time between messages per bot
const CHAT_MAX_MS = 60000   // maximum time between messages per bot

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function scheduleChat(client, username) {
  const delay = randomInt(CHAT_MIN_MS, CHAT_MAX_MS)
  setTimeout(() => {
    const message = MESSAGES[randomInt(0, MESSAGES.length - 1)]
    client.queue('text', {
      needs_translation: false,
      category: 1,  // authored (player chat)
      type: 1,      // chat
      source_name: username,
      message,
      xuid: '',
      platform_chat_id: '',
      has_filtered_message: false
    })
    console.log(`[${username}] says: ${message}`)
    scheduleChat(client, username)
  }, delay)
}

function spawnBot(index) {
  const username = NAMES[index]

  const client = bedrock.createClient({
    host: HOST,
    port: PORT,
    username,
    version: '26.10',
    offline: true
  })

  client.on('spawn', () => {
    console.log(`[${username}] spawned`)
    scheduleChat(client, username)
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
