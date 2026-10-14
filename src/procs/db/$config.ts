// db module config schema. ENV enters through here: DATABASE_URL → config.url.
// package.json procs.prod."procs/db" can set a default; env overrides.
// hyper-code2's Postgres lives in ~/.hyper/docker-compose.yml (paradedb, 127.0.0.1:54393).
// No built-in default: a URL with a well-known password is a superuser for anyone who reaches the port
// (incident 14.10 — the repo is public). script/install.sh generates the password and writes DATABASE_URL to .env.
export default {
    url: { type: "string", required: true, env: "DATABASE_URL" },
} as const satisfies ConfigSchema;
