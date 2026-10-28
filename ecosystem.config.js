module.exports = {
  apps: [
    {
      name: 'replication-job',
      script: 'dist/index.js', // JS đã build
      args: 'cron',
      exec_mode: 'cluster',
      instances: 4,
      max_memory_restart: '2G',
      kill_timeout: 120000,
      env: {
        NODE_ENV: 'production',
        NODE_APP_INSTANCES: '4',
      },
    },
  ],
};
