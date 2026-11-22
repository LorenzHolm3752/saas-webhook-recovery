import { createHmac, randomUUID } from "node:crypto";
import { createServer, type ServerResponse } from "node:http";
import { z } from "zod";
import { createInfraiClient, InfraiError } from "./infrai_control_plane.js";
import {
  deliverySchema,
  recoveryRequestSchema,
  selectMissedDeliveries,
  type Delivery
} from "./recovery_plan.js";

const historySchema = z.union([
  z.array(deliverySchema),
  z.object({ deliveries: z.array(deliverySchema) }).transform(({ deliveries }) => deliveries),
  z.object({ items: z.array(deliverySchema) }).transform(({ items }) => items)
]);

function sendJson(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

async function readJson(request: AsyncIterable<Uint8Array>): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 64 * 1024) throw new Error("request body exceeds 64 KiB");
    chunks.push(Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function replayDelivery(
  targetUrl: string,
  secret: string,
  delivery: Delivery
): Promise<void> {
  const body = JSON.stringify(delivery.payload);
  const signature = createHmac("sha256", secret).update(body).digest("hex");
  const response = await fetch(targetUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-webhook-event": delivery.event_type,
      "x-webhook-id": delivery.id,
      "x-webhook-signature": signature,
      "idempotency-key": delivery.id
    },
    body
  });
  if (!response.ok) throw new Error(`Replay target returned HTTP ${response.status}`);
}

export function startRecoveryService() {
  const apiKey = process.env.INFRAI_API_KEY;
  const targetUrl = process.env.REPLAY_TARGET_URL;
  const webhookSecret = process.env.WEBHOOK_SECRET;
  if (!apiKey || !targetUrl || !webhookSecret) {
    throw new Error("INFRAI_API_KEY, REPLAY_TARGET_URL, and WEBHOOK_SECRET are required");
  }

  const infrai = createInfraiClient(apiKey);
  const server = createServer(async (request, response) => {
    if (request.method !== "POST" || request.url !== "/recover") {
      sendJson(response, 404, { error: "not_found" });
      return;
    }

    try {
      const recovery = recoveryRequestSchema.parse(await readJson(request));
      const history = historySchema.parse(
        await infrai.account.webhooks.deliveries<unknown>(recovery.webhookId)
      );
      const selected = selectMissedDeliveries(history, recovery);

      for (const delivery of selected) await replayDelivery(targetUrl, webhookSecret, delivery);

      const delayMs = 60_000 / recovery.messagesPerMinute;
      const redriven: unknown[] = [];
      for (const [index, messageId] of recovery.deadLetterMessageIds.entries()) {
        const result = await infrai.queue.dlq.redrive<unknown>(
          recovery.queue,
          messageId,
          `recovery-${recovery.tenantId}-${messageId}`
        );
        redriven.push(result);
        if (index < recovery.deadLetterMessageIds.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      }

      sendJson(response, 200, {
        recoveryId: randomUUID(),
        tenantId: recovery.tenantId,
        replayedDeliveryIds: selected.map(({ id }) => id),
        redriveCount: redriven.length
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        sendJson(response, 400, { error: "invalid_request", issues: error.issues });
      } else if (error instanceof InfraiError) {
        sendJson(response, error.status >= 400 && error.status < 500 ? error.status : 502, {
          error: error.code
        });
      } else {
        sendJson(response, 502, { error: "recovery_failed" });
      }
    }
  });

  server.listen(Number(process.env.PORT ?? 3000));
  return server;
}

if (process.env.NODE_ENV !== "test") startRecoveryService();
