// Creates the sync sidecar's Python 3.12 venv (sidecar/.venv) and installs its
// pinned requirements. Safe to re-run.
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const sidecar = join(dirname(fileURLToPath(import.meta.url)), '..', 'sidecar')
const venv = join(sidecar, '.venv')
const python = join(venv, 'Scripts', 'python.exe')
const run = (cmd, args) => execFileSync(cmd, args, { stdio: 'inherit' })

if (!existsSync(python)) run('py', ['-3.12', '-m', 'venv', venv])
run(python, ['-m', 'pip', 'install', '--upgrade', 'pip'])
run(python, ['-m', 'pip', 'install', '-r', join(sidecar, 'requirements.txt'), '-r', join(sidecar, 'requirements-dev.txt')])
