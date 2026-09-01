module.exports = {
  apps: [{
    name: 'petnica-igraonica',
    script: 'dist-server/index.js',
    cwd: __dirname,
    env: {
      NODE_ENV: 'production',
      PORT: 3123,
      DATABASE_PATH: './data/igraonica.db'
    }
  }]
};
