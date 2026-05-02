#!/usr/bin/env node
/**
 * Waits for the WXT dev extension output, then opens two Helium windows with
 * distinct Chromium profiles (see .env).
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function loadEnvFile() {
  const p = join(root, '.env');
  if (!existsSync(p)) return;
  for (let line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    line = line.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

function expandPath(p) {
  if (!p) return p;
  return p.replace(/^~(?=\/|\\|$)/, homedir());
}

function defaultHeliumUserData() {
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'Helium');
  }
  if (process.platform === 'win32') {
    return join(homedir(), 'AppData', 'Local', 'Helium', 'User Data');
  }
  return join(homedir(), '.config', 'helium');
}

function resolveBinary() {
  const fromEnv = process.env.WXT_HELIUM_PATH?.trim();
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  const darwin = '/Applications/Helium.app/Contents/MacOS/Helium';
  if (process.platform === 'darwin' && existsSync(darwin)) return darwin;
  return null;
}

function waitForManifest(manifestPath, timeoutMs) {
  const start = Date.now();
  return new Promise((resolveWait, reject) => {
    const tick = () => {
      if (existsSync(manifestPath)) {
        resolveWait();
        return;
      }
      if (Date.now() - start > timeoutMs) {
        reject(new Error(`Timeout waiting for dev build: ${manifestPath}`));
        return;
      }
      setTimeout(tick, 400);
    };
    tick();
  });
}

function launch(binary, userDataDir, profileDir, extDir, label) {
  const args = [
    `--load-extension=${extDir}`,
    `--disable-extensions-except=${extDir}`,
    `--user-data-dir=${userDataDir}`,
    `--profile-directory=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
  ];
  const child = spawn(binary, args, { detached: true, stdio: 'ignore' });
  child.unref();
  console.log(`[helium] Launched "${label}" (profile dir: ${profileDir}, user data: ${userDataDir})`);
}

loadEnvFile();

const binary = resolveBinary();
if (!binary) {
  console.error(
    '[helium] No Helium binary found. Set WXT_HELIUM_PATH in .env or install Helium in /Applications.',
  );
  process.exit(1);
}

const extDir = resolve(root, process.env.WXT_DEV_EXTENSION_DIR?.trim() || '.output/chrome-mv3-dev');
const manifestPath = join(extDir, 'manifest.json');

const profileExh = (process.env.HELIUM_PROFILE_TESTUSER1 || 'TestUser1').trim();
const profileVoy = (process.env.HELIUM_PROFILE_TESTUSER2 || 'TestUser2').trim();

const userDataExh = expandPath(
  process.env.HELIUM_USER_DATA_DIR_TESTUSER1?.trim() ||
    process.env.HELIUM_USER_DATA_DIR?.trim() ||
    defaultHeliumUserData(),
);
const userDataVoy = expandPath(
  process.env.HELIUM_USER_DATA_DIR_TESTUSER2?.trim() ||
    process.env.HELIUM_USER_DATA_DIR?.trim() ||
    defaultHeliumUserData(),
);

const delayMs = Math.max(0, Number(process.env.HELIUM_SECOND_WINDOW_DELAY_MS) || 2000);
const waitBuildMs = Math.max(5000, Number(process.env.HELIUM_WAIT_DEV_BUILD_MS) || 120_000);

console.log(`[helium] Waiting for dev extension at ${manifestPath} …`);

waitForManifest(manifestPath, waitBuildMs)
  .then(() => {
    launch(binary, userDataExh, profileExh, extDir, 'TestUser1');
    setTimeout(() => {
      launch(binary, userDataVoy, profileVoy, extDir, 'TestUser2');
    }, delayMs);
  })
  .catch((err) => {
    console.error('[helium]', err.message || err);
    process.exit(1);
  });
