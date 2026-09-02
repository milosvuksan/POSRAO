const path = require('node:path');

module.exports = {
  apps: [{
    name: 'posrao',
    script: 'dist-server/index.js',
    cwd: __dirname,
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    watch: false,
    time: true,
    max_memory_restart: '256M',
    restart_delay: 2_000,
    env: {
      NODE_ENV: 'production',
      PORT: 3123,
      DATABASE_PATH: path.join(__dirname, 'data', 'igraonica.db'),
    }
  }]
};
