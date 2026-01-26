module.exports = {
  apps: [
    {
      name: 'replication-job',
      script: 'dist/scripts/store-replication.js', // JS đã build
      exec_mode: 'cluster',
      instances: 4,
      max_memory_restart: '2G',
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
