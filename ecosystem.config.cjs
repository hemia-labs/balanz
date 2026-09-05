module.exports = {
  apps: [
    {
      name: "balanz-web-dev",
      cwd: `${__dirname}/apps/web`,
      script: "node_modules/next/dist/bin/next",
      args: "start --hostname 127.0.0.1 --port 5181",
      env: { NODE_ENV: "production" },
    },
    {
      name: "balanz-api-dev",
      cwd: `${__dirname}/apps/api`,
      script: "dist/main.js",
      node_args: "--env-file=/srv/apps/balanz/shared/api.env",
      env: { NODE_ENV: "production" },
    },
    {
      name: "balanz-worker-dev",
      cwd: `${__dirname}/apps/api`,
      script: "dist/worker.js",
      node_args: "--env-file=/srv/apps/balanz/shared/worker.env",
      env: { NODE_ENV: "production" },
      kill_timeout: 125000,
    },
  ],
};
