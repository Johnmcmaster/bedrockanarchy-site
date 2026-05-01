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
let prevPos   = { x: 0, y: 64, z: 0 }
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
  runtimeId = Number(packet.runtime_entity_id)
  pos.x = packet.player_position.x
  pos.y = packet.player_position.y
  pos.z = packet.player_position.z
  prevPos = { ...pos }
})

// accept forced server repositions and re-pick a nearby target
client.on('move_player', (packet) => {
  if (Number(packet.runtime_id) === runtimeId && (packet.mode === 'teleport' || packet.mode === 'reset')) {
    pos.x = packet.position.x
    pos.y = packet.position.y
    pos.z = packet.position.z
    prevPos = { ...pos }
    console.log(`[${USERNAME}] teleported to ${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)}`)
    pickTarget()
  }
})

client.on('respawn', (packet) => {
  if (packet.state === 1) {
    console.log(`[${USERNAME}] died, respawning`)
    pos.x = packet.position.x
    pos.y = packet.position.y
    pos.z = packet.position.z
    prevPos = { ...pos }
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

    const delta = {
      x: pos.x - prevPos.x,
      y: pos.y - prevPos.y,
      z: pos.z - prevPos.z
    }
    prevPos = { ...pos }

    // player_auth_input is the authoritative movement packet in Bedrock 1.19+
    client.queue('player_auth_input', {
      pitch: 0,
      yaw,
      position: { x: pos.x, y: pos.y + 1.62, z: pos.z },
      move_vector: moving ? { x: 0, z: 1 } : { x: 0, z: 0 },
      head_yaw: yaw,
      input_data: {
        up: moving,
        ascend: false, descend: false, north_jump: false, jump_down: false,
        sprint_down: false, change_height: false, jumping: false,
        auto_jumping_in_water: false, sneaking: false, sneak_down: false,
        down: false, left: false, right: false, up_left: false, up_right: false,
        want_up: false, want_down: false, want_down_slow: false, want_up_slow: false,
        sprinting: false, ascend_block: false, descend_block: false,
        sneak_toggle_down: false, persist_sneak: false, start_sprinting: false,
        stop_sprinting: false, start_sneaking: false, stop_sneaking: false,
        start_swimming: false, stop_swimming: false, start_jumping: false,
        start_gliding: false, stop_gliding: false, item_interact: false,
        block_action: false, item_stack_request: false, handled_teleport: false,
        emoting: false, missed_swing: false, start_crawling: false,
        stop_crawling: false, start_flying: false, stop_flying: false,
        received_server_data: false, client_predicted_vehicle: false,
        paddling_left: false, paddling_right: false,
        block_breaking_delay_enabled: false, horizontal_collision: false,
        vertical_collision: false, down_left: false, down_right: false,
        start_using_item: false, camera_relative_movement_enabled: false,
        rot_controlled_by_move_direction: false, start_spin_attack: false,
        stop_spin_attack: false, hotbar_only_touch: false,
        jump_released_raw: false, jump_pressed_raw: false, jump_current_raw: false,
        sneak_released_raw: false, sneak_pressed_raw: false, sneak_current_raw: false
      },
      input_mode: 'mouse',
      play_mode: 'normal',
      interaction_model: 'crosshair',
      interact_rotation: { x: 0, z: 0 },
      tick,
      delta,
      analogue_move_vector: moving ? { x: 0, z: 1 } : { x: 0, z: 0 },
      camera_orientation: { x: 0, y: 0, z: 0 },
      raw_move_vector: moving ? { x: 0, z: 1 } : { x: 0, z: 0 }
    })
  }, TICK_MS)
})

client.on('disconnect', ({ message }) => console.log(`[${USERNAME}] disconnected: ${message}`))
client.on('error', err => console.error(`[${USERNAME}] error: ${err.message}`))
