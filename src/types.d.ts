declare module 'music-tag-native'
declare module 'vm2'
declare module '*.json'

declare global {
  // Minimal compatibility object used by copied lxserver SDK modules.
  // eslint-disable-next-line no-var
  var lx: any

  namespace LX {
    type OnlineSource = 'kw' | 'kg' | 'tx' | 'wy' | 'mg' | 'bd' | 'xm' | string
    type Quality = '128k' | '192k' | '320k' | 'flac' | 'flac24bit' | 'master' | 'wav' | string
  }
}

export {}
