export const HOST_KINDS = ['hello', 'status', 'notify', 'ping', 'screenshot', 'tap'] as const

export const DEVICE_KINDS = [
  'hello.ack',
  'notify.ack',
  'device.event',
  'pong',
  'screenshot.ack',
  'tap.ack',
] as const

export const ALL_KINDS = [...HOST_KINDS, ...DEVICE_KINDS] as const

export type HostKind = (typeof HOST_KINDS)[number]
export type DeviceKind = (typeof DEVICE_KINDS)[number]
export type Kind = HostKind | DeviceKind

// One shared vocabulary. Device-side caps describe hardware
// (display/buttons/touch/haptic). notify is the only non-display host cap left.
export const CAPS = ['display', 'buttons', 'touch', 'haptic', 'notify'] as const
export type Cap = (typeof CAPS)[number]

// Coarse session liveness reported by the daemon. `active` = a Claude Code
// process is alive (statusLine ticking or PID still present); `idle` = no live
// session. The device derives NoLink locally from link silence.
export const STATES = ['active', 'idle'] as const
export type State = (typeof STATES)[number]

export const URGENCY = ['low', 'normal', 'high'] as const
export type Urgency = (typeof URGENCY)[number]
