#!/usr/bin/env node
// Runs the Study app on your own computer at http://localhost:5173
//   node scripts/start.mjs            install (first time), build if needed, serve, open the browser
//   node scripts/start.mjs --no-open  same, without opening a browser
//   node scripts/start.mjs --rebuild  force a fresh build
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
const args = new Set(process.argv.slice(2));
const isWin = process.platform === 'win32';
const npm = isWin ? 'npm.cmd' : 'npm';
const say = (m) => console.log(`\n\x1b[1m${m}\x1b[0m`);

const major = Number(process.versions.node.split('.')[0]);
if (major < 18) {
  console.error(`\nNode.js 18 or newer is needed (you have ${process.versions.node}).\nInstall the LTS version from https://nodejs.org and run this again.`);
  process.exit(1);
}

function run(cmd, cmdArgs) {
  const r = spawnSync(cmd, cmdArgs, { stdio: 'inherit', shell: isWin });
  if (r.status !== 0) {
    console.error(`\n"${cmd} ${cmdArgs.join(' ')}" failed. Scroll up to see why, or send the message to Claude.`);
    process.exit(r.status || 1);
  }
}

// 1. dependencies (first run only)
if (!existsSync(join(root, 'node_modules', 'vite'))) {
  say('First run: installing (about a minute)…');
  run(npm, ['install', '--no-audit', '--no-fund']);
}

// 2. optional Supabase details, saved to .env.local so they survive restarts
if (!existsSync('.env.local') && process.stdin.isTTY && !args.has('--no-prompt')) {
  console.log('\nTo sync between devices, paste your Supabase details. You can also skip this (press Enter)\nand add them later in the app under Settings → Sync.');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  let url = (await rl.question('\nProject URL (https://xxxx.supabase.co): ')).trim();
  let key = '';
  if (url) {
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    key = (await rl.question('Publishable key (sb_publishable_…): ')).trim();
    if (key.startsWith('sb_secret_')) {
      console.log('That is the SECRET key – not saving it. Use the publishable key instead.');
      key = '';
    }
  }
  rl.close();
  writeFileSync('.env.local', url && key ? `VITE_SUPABASE_URL=${url.replace(/\/+$/, '')}\nVITE_SUPABASE_ANON_KEY=${key}\n` : '# Supabase not configured – add it in the app under Settings → Sync\n');
}

// 3. build when missing or older than the source
function newest(dir) {
  let t = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    t = Math.max(t, e.isDirectory() ? newest(p) : statSync(p).mtimeMs);
  }
  return t;
}
const built = existsSync('dist/index.html') ? statSync('dist/index.html').mtimeMs : 0;
const srcTime = Math.max(newest('src'), newest('public'), statSync('index.html').mtimeMs, existsSync('.env.local') ? statSync('.env.local').mtimeMs : 0);
if (args.has('--rebuild') || !built || srcTime > built) {
  say('Building the app…');
  run(npm, ['run', 'build']);
}

// 4. serve
say('Starting…  (press Ctrl+C in this window to stop)');
const vite = join(root, 'node_modules', 'vite', 'bin', 'vite.js');
const server = spawn(process.execPath, [vite, 'preview', '--host', '--port', '5173', ...(args.has('--no-open') ? [] : ['--open'])], { stdio: 'inherit' });
server.on('exit', (code) => process.exit(code ?? 0));
process.on('SIGINT', () => server.kill('SIGINT'));
