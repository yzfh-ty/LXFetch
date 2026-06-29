#!/usr/local/bin/node

const fs = require('node:fs')
const { spawn } = require('node:child_process')

const uid = Number(process.env.PUID || 1000)
const gid = Number(process.env.PGID || 1000)
const command = process.argv.slice(2)

const fail = message => {
  console.error(`[lxfetch] ${message}`)
  process.exit(1)
}

if (!Number.isInteger(uid) || uid < 0) fail(`Invalid PUID: ${process.env.PUID}`)
if (!Number.isInteger(gid) || gid < 0) fail(`Invalid PGID: ${process.env.PGID}`)
if (!command.length) fail('Missing startup command')

const chownRecursive = target => {
  if (!fs.existsSync(target)) fs.mkdirSync(target, { recursive: true })
  const stat = fs.lstatSync(target)
  fs.chownSync(target, uid, gid)
  if (!stat.isDirectory()) return
  for (const entry of fs.readdirSync(target)) chownRecursive(`${target}/${entry}`)
}

for (const dir of ['/app/data', '/app/downloads']) {
  try {
    chownRecursive(dir)
  } catch (error) {
    fail(`Failed to prepare ${dir}: ${error.message}`)
  }
}

try {
  if (process.setgroups) process.setgroups([])
  process.setgid(gid)
  process.setuid(uid)
} catch (error) {
  fail(`Failed to switch to ${uid}:${gid}: ${error.message}`)
}

const child = spawn(command[0], command.slice(1), { stdio: 'inherit' })

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal))
}

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  process.exit(code ?? 0)
})
