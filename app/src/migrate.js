/**
 * Minimal migration script:
 * - creates a single 'orders' table if it doesn't exist
 * This runs as a one-off ECS task using the latest task definition revision
 * via command override: `npm run migrate`.
 *
 * Required env vars:
 * - DB_HOST
 * - DB_USER
 * - DB_PASSWORD
 * - DB_NAME
 */
const { Client } = require("pg");

async function main() {
  const db = new Client({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: Number(process.env.DB_PORT || "5432"),
    ssl: process.env.DB_SSL === "true" ? { rejectUnauthorized: false } : undefined
  });

  await db.connect();

  await db.query(`
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  console.log("Migration complete");
  await db.end();
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});