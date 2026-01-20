/**
 * Minimal demo worker:
 * - poll SQS
 * - write to Postgres
 * - expose /health for ALB health checks (not a user-facing API)
 *
 * This is intentionally simple for the tech test.
 */

const http = require("http");
const { SQSClient, ReceiveMessageCommand, DeleteMessageCommand } = require("@aws-sdk/client-sqs");
const { Client } = require("pg");

const queueUrl = process.env.SQS_QUEUE_URL;
const region = process.env.AWS_REGION || "ap-southeast-2";
const healthPort = Number(process.env.HEALTH_PORT || "8080");

async function main() {
  if (!queueUrl) {
    console.error("SQS_QUEUE_URL is not set");
    process.exit(1);
  }

  /**
   * Health endpoint
   * Used only by ALB target group health checks.
   * This service is NOT a user-facing HTTP API.
   */
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

  const sqs = new SQSClient({ region });

  const db = new Client({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: Number(process.env.DB_PORT || "5432")
  });

  await db.connect();
  console.log("Connected to DB, polling SQS");

  /**
   * Long-running worker loop
   */
  while (true) {
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
  }
}

main().catch((err) => {
  console.error("Worker crashed:", err);
  process.exit(1);
});