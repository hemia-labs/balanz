module.exports = {
  apps: [
    {
      name: "balanz-web-dev",
      cwd: __dirname,
      script: "scripts/deploy/run-isolated-runtime.sh",
      args: "web",
      interpreter: "/bin/bash",
      env: { NODE_ENV: "production" },
    },
    {
      name: "balanz-api-dev",
      cwd: __dirname,
      script: "scripts/deploy/run-isolated-runtime.sh",
      args: "api",
      interpreter: "/bin/bash",
      env: { NODE_ENV: "production" },
    },
    {
      name: "balanz-worker-dev",
      cwd: __dirname,
      script: "scripts/deploy/run-isolated-runtime.sh",
      args: "worker",
      interpreter: "/bin/bash",
      env: { NODE_ENV: "production" },
      // Exceeds the validated WORKER_SHUTDOWN_GRACE_MS maximum (120 seconds).
      kill_timeout: 125000,
    },
  ],
};
