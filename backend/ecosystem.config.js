module.exports = {
  apps: [
    {
      name: "clawbench-backend",
      script: "./dist/index.js",
      instances: 8, // Enable cluster mode (use all CPU cores) , "max"
      exec_mode: "cluster",
      watch: false,
      max_memory_restart: "1G",
      env: {
        NODE_ENV: "development",
      },
      env_production: {
        NODE_ENV: "production",
      },
      // Logs configuration
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      error_file: "./logs/pm2-error.log",
      out_file: "./logs/pm2-out.log",
      merge_logs: true,
    },
  ],
};
