const bedrock = require('bedrock-protocol')

const HOST = 'bedrockanarchy.org'
const PORT = 19132
const USERNAME = 'xX_Vortex_Xx'

const WALK_SPEED   = 0.15  // blocks per tick
const TICK_MS      = 50    // 20 ticks/sec
const WANDER_MIN   = 8
const WANDER_MAX   = 24
const IDLE_MIN_MS  = 1500
const IDLE_MAX_MS  = 4000

let runtimeId = 0
let pos       = { x: 0, y: 64, z: 0 }
let yaw       = 0
let target    = null
let moving    = false
let tick      = 0

function rand(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function pickTarget() {
  const angle = Math.random() * Math.PI * 2
  const dist  = rand(WANDER_MIN, WANDER_MAX)
  target = { x: pos.x + Math.cos(angle) * dist, z: pos.z + Math.sin(angle) * dist }
  moving = true
  console.log(`[${USERNAME}] walking to ${target.x.toFixed(1)}, ${target.z.toFixed(1)}`)
}

function idle() {
  moving = false
  target = null
  setTimeout(pickTarget, rand(IDLE_MIN_MS, IDLE_MAX_MS))
}

const client = bedrock.createClient({
  host: HOST, port: PORT, username: USERNAME, version: '26.10', offline: true
})

client.on('start_game', (packet) => {
  runtimeId = packet.runtime_entity_id
  pos.x = packet.player_position.x
  pos.y = packet.player_position.y
  pos.z = packet.player_position.z
})

// accept server position corrections
client.on('move_player', (packet) => {
  if (packet.runtime_id === runtimeId) {
    pos.x = packet.position.x
    pos.y = packet.position.y
    pos.z = packet.position.z
  }
})

client.on('respawn', (packet) => {
  if (packet.state === 1) {
    console.log(`[${USERNAME}] died, respawning`)
    pos.x = packet.position.x
    pos.y = packet.position.y
    pos.z = packet.position.z
    client.queue('respawn', {
      position: packet.position,
      state: 2,
      runtime_entity_id: packet.runtime_entity_id
    })
  }
})

client.on('spawn', () => {
  console.log(`[${USERNAME}] spawned`)
  pickTarget()

  setInterval(() => {
    tick++

    if (moving && target) {
      const dx   = target.x - pos.x
      const dz   = target.z - pos.z
      const dist = Math.sqrt(dx * dx + dz * dz)

      if (dist < 0.5) {
        console.log(`[${USERNAME}] reached target, idling`)
        idle()
      } else {
        const step = Math.min(WALK_SPEED, dist)
        pos.x += (dx / dist) * step
        pos.z += (dz / dist) * step
        yaw = Math.atan2(dx, dz) * (180 / Math.PI)
      }
    }

    client.queue('move_player', {
      runtime_id: runtimeId,
      position: { x: pos.x, y: pos.y, z: pos.z },
      pitch: 0,
      yaw,
      head_yaw: yaw,
      mode: 'normal',
      on_ground: true,
      ridden_runtime_id: 0,
      tick
    })
  }, TICK_MS)
})

client.on('disconnect', ({ message }) => console.log(`[${USERNAME}] disconnected: ${message}`))
client.on('error', err => console.error(`[${USERNAME}] error: ${err.message}`))
