/**
 * Minimal demo worker:
 * - poll SQS
 * - write to Postgres
 * - expose /health for ALB health checks
 *
 * Intentionally simple, but ECS-safe.
 */

const http = require("http");
const { SQSClient, ReceiveMessageCommand, DeleteMessageCommand } = require("@aws-sdk/client-sqs");
const { Client } = require("pg");

const queueUrl = process.env.SQS_QUEUE_URL;
const region = process.env.AWS_REGION || "ap-southeast-2";
const healthPort = Number(process.env.HEALTH_PORT || "8080");

let shuttingDown = false;

/**
 * Health endpoint
 * Must NOT depend on DB or SQS readiness.
 */
function startHealthServer() {
  const server = http.createServer((req, res) => {
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("OK");
      return;
    }

    res.writeHead(404);
    res.end();
  });

  server.listen(healthPort, () => {
    console.log(`Health endpoint listening on :${healthPort}`);
  });
}

/**
 * Graceful shutdown handling (ECS stop / deploy)
 */
function setupSignalHandlers(db) {
  const shutdown = async (signal) => {
    console.log(`Received ${signal}, shutting down`);
    shuttingDown = true;

    try {
      if (db) {
        await db.end();
        console.log("DB connection closed");
      }
    } catch (err) {
      console.error("Error during shutdown:", err);
    }

    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  if (!queueUrl) {
    console.error("SQS_QUEUE_URL is not set");
    process.exit(1);
  }

  // Start health endpoint FIRST
  startHealthServer();

  const sqs = new SQSClient({ region });

  const sslEnabled = process.env.DB_SSL !== "false";

  const db = new Client({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: Number(process.env.DB_PORT || "5432"),
    ssl: sslEnabled ? { rejectUnauthorized: false } : undefined
  });

  setupSignalHandlers(db);

  /**
   * Connect to DB with retry
   */
  while (!shuttingDown) {
    try {
      await db.connect();
      console.log("Connected to DB");
      break;
    } catch (err) {
      console.error("Failed to connect to DB, retrying in 5s:", err.message);
      await sleep(5000);
    }
  }

  /**
   * Long-running worker loop
   */
  while (!shuttingDown) {
    try {
      const resp = await sqs.send(
        new ReceiveMessageCommand({
          QueueUrl: queueUrl,
          WaitTimeSeconds: 20,
          MaxNumberOfMessages: 1
        })
      );

      const msgs = resp.Messages || [];
      for (const msg of msgs) {
        await db.query(
          "INSERT INTO orders(id, status) VALUES($1, $2) ON CONFLICT (id) DO NOTHING",
          [msg.MessageId, "RECEIVED"]
        );

        await sqs.send(
          new DeleteMessageCommand({
            QueueUrl: queueUrl,
            ReceiptHandle: msg.ReceiptHandle
          })
        );

        console.log("Processed message", msg.MessageId);
      }
    } catch (err) {
      console.error("Worker loop error, retrying in 5s:", err);
      await sleep(5000);
    }
  }
}

main().catch((err) => {
  console.error("Fatal worker error:", err);
  process.exit(1);
});