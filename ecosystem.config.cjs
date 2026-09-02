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
      env: { NODE_ENV: "production", APP_PORT: "3021" },
    },
  ],
};
