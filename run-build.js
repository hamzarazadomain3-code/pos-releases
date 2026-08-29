const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const log = fs.createWriteStream(path.join(__dirname, 'build-progress.log'));
const write = (msg) => { const line = `${new Date().toISOString()} ${msg}`; log.write(line + '\n'); console.log(line); };

write('Starting electron-builder...');

const child = spawn('npx.cmd', ['electron-builder', '--publish', 'always'], {
  cwd: __dirname,
  env: { ...process.env, GH_TOKEN: fs.readFileSync(path.join(__dirname, 'eb_token.txt'), 'utf8').trim() },
  shell: true,
  stdio: ['ignore', 'pipe', 'pipe']
});

child.stdout.on('data', (d) => write(d.toString()));
child.stderr.on('data', (d) => write('ERR: ' + d.toString()));

child.on('close', (code) => {
  write(`Process exited with code ${code}`);
  log.end();
  process.exit(code);
});

child.on('error', (err) => {
  write(`Process error: ${err.message}`);
  log.end();
  process.exit(1);
});

setInterval(() => {
  const exe = path.join(__dirname, 'dist_release', 'ShopKeeperPOS-Setup-1.8.7.exe');
  if (fs.existsSync(exe)) {
    const stat = fs.statSync(exe);
    write(`Installer found: ${(stat.size / 1024 / 1024).toFixed(1)} MB`);
  }
}, 60000);
