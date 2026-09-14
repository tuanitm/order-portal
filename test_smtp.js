const nodemailer = require('nodemailer');
const fs = require('fs');
const { execSync } = require('child_process');

const env = fs.readFileSync('.env', 'utf-8');
const m = env.match(/SMTP_PASS=(?:FERNET:)?([^\r\n]+)/);
const raw = m ? m[1] : '';
let pass = raw;
if (raw.startsWith('gAAAAA')) {
  pass = execSync(
    `python -c "from cryptography.fernet import Fernet; key = open(r'scripts/.encryption_key','rb').read(); f = Fernet(key); print(f.decrypt(b'${raw}').decode(), end='')"`,
    { encoding: 'utf-8' }
  ).trim();
}
console.log('Decrypted password:', repr(pass));
console.log('Password length:', pass.length);

function repr(s) {
  return JSON.stringify(s);
}

// Test 1: Port 465 SSL
console.log('\n--- Test 1: Port 465, secure=true ---');
test(465, true);

// Test 2: Port 587 STARTTLS
setTimeout(() => {
  console.log('\n--- Test 2: Port 587, secure=false (STARTTLS) ---');
  test(587, false);
}, 5000);

// Test 3: Port 994 SSL (some 163 servers use this)
setTimeout(() => {
  console.log('\n--- Test 3: Port 994, secure=true ---');
  test(994, true);
}, 10000);

function test(port, secure) {
  const t = nodemailer.createTransport({
    host: 'hwhzsmtp.qiye.163.com',
    port: port,
    secure: secure,
    auth: { user: 'agent@imv.com.vn', pass: pass },
    tls: { rejectUnauthorized: false },
    authMethod: 'LOGIN',
  });
  t.verify()
    .then((r) => console.log(`  Port ${port} OK:`, r))
    .catch((e) => console.log(`  Port ${port} ERROR:`, e.message));
}
