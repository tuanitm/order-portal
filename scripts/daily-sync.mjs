/**
 * Daily SAP sync — pulls SAP Customers, Items, Price Lists, Contract
 * Discounts, and Promotions into the local MySQL cache via the app's own
 * admin API (so it exercises the exact same code path as clicking the
 * sync buttons).
 *
 * Run manually:  node scripts/daily-sync.mjs
 * Schedule with Windows Task Scheduler to run this daily — see
 * scripts/register-daily-sync-task.ps1 for a ready-made registration script.
 *
 * Requires the app to already be running (defaults to http://localhost:3000,
 * override with PORTAL_BASE_URL env var) and logs in with the config.json
 * bootstrap admin credential — the same one used for the "/admin" login.
 */
import { readFileSync, appendFileSync } from 'fs';
import { execSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');
const baseUrl = process.env.PORTAL_BASE_URL || 'http://localhost:3000';
const logFile = join(rootDir, 'daily-sync.log');

function log(message) {
  const line = `[${new Date().toISOString()}] ${message}`;
  console.log(line);
  try {
    appendFileSync(logFile, line + '\n');
  } catch {
    // Non-fatal if the log file can't be written (e.g. permissions) — console output still happened.
  }
}

function resolveEnvSecret(envVarName) {
  const envContent = readFileSync(join(rootDir, '.env'), 'utf-8');
  const match = envContent.match(new RegExp(`${envVarName}=["']?([^"'\r\n]+)["']?`));
  const rawValue = match ? match[1] : '';
  const token = rawValue.replace(/^FERNET:/, '');
  if (!token.startsWith('gAAAAA')) return rawValue;

  const keyPath = join(rootDir, 'scripts', '.encryption_key');
  return execSync(
    `python -c "from cryptography.fernet import Fernet; key = open(r'${keyPath}','rb').read(); f = Fernet(key); print(f.decrypt(b'${token}').decode(), end='')"`,
    { encoding: 'utf-8', timeout: 10000 }
  ).trim();
}

async function loginAsAdmin() {
  const config = JSON.parse(readFileSync(join(rootDir, 'config.json'), 'utf-8'));
  const email = config.admin.email.startsWith('ENV:')
    ? resolveEnvSecret(config.admin.email.replace('ENV:', ''))
    : config.admin.email;
  const password = config.admin.password.startsWith('ENV:')
    ? resolveEnvSecret(config.admin.password.replace('ENV:', ''))
    : config.admin.password;

  const res = await fetch(`${baseUrl}/api/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    throw new Error(`Admin login failed: ${res.status} ${await res.text()}`);
  }
  const setCookie = res.headers.get('set-cookie');
  if (!setCookie) throw new Error('Admin login succeeded but no session cookie was returned');
  return setCookie.split(';')[0];
}

async function runSync(cookie, label, path) {
  try {
    const res = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { Cookie: cookie },
    });
    const data = await res.json();
    if (!res.ok) {
      log(`✗ ${label} failed (${res.status}): ${data.message || data.error}`);
      return false;
    }
    log(`✓ ${label}: ${JSON.stringify(data)}`);
    return true;
  } catch (error) {
    log(`✗ ${label} threw: ${error.message}`);
    return false;
  }
}

async function main() {
  log('=== Daily sync starting ===');
  let cookie;
  try {
    cookie = await loginAsAdmin();
  } catch (error) {
    log(`✗ Could not log in as admin: ${error.message}`);
    process.exit(1);
  }

  const steps = [
    ['SAP Customers', '/api/admin/sap-customers/sync'],
    ['Items', '/api/admin/items/sync'],
    ['Price Lists', '/api/admin/price-lists/sync'],
    ['Contract Discounts', '/api/admin/contract-discounts/agreements/sync'],
    ['Promotions', '/api/admin/promotions/sync'],
  ];

  let allOk = true;
  for (const [label, path] of steps) {
    const ok = await runSync(cookie, label, path);
    allOk = allOk && ok;
  }

  log(`=== Daily sync ${allOk ? 'completed successfully' : 'completed with errors'} ===`);
  process.exit(allOk ? 0 : 1);
}

main();
