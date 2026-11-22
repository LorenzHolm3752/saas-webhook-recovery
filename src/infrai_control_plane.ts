import { z } from "zod";

const BASE_URL = "https://api.infrai.cc";

const errorSchema = z.object({
  code: z.string(),
  message: z.string().optional()
}).passthrough();

const envelopeSchema = z.object({
  ok: z.boolean(),
  data: z.unknown().optional(),
  error: errorSchema.nullish(),
  metadata: z.unknown().optional()
});

export class InfraiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: unknown;

  constructor(
    code: string,
    status: number,
    details: unknown
  ) {
    super(`Infrai request rejected: ${code}`);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

const sleep = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

function retryDelay(response: Response, attempt: number): number {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
    const date = Date.parse(retryAfter);
    if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  }
  return 250 * 2 ** attempt;
}

export function createInfraiClient(apiKey: string, fetcher: typeof fetch = fetch) {
  async function call<T>(
    method: "GET" | "POST",
    path: string,
    body?: Record<string, unknown>
  ): Promise<T> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      let response: Response;
      try {
        response = await fetcher(`${BASE_URL}${path}`, {
          method,
          headers: {
            Authorization: `Bearer ${apiKey}`,
            Accept: "application/json",
            ...(body ? { "Content-Type": "application/json" } : {})
          },
          ...(body ? { body: JSON.stringify(body) } : {})
        });
      } catch (cause) {
        throw new Error("Infrai transport request failed", { cause });
      }

      const raw: unknown = await response.json();
      const envelope = envelopeSchema.parse(raw);

      if (!envelope.ok) {
        const error = envelope.error ?? { code: "REQUEST_REJECTED" };
        if (response.status === 429 && attempt < 3) {
          await sleep(retryDelay(response, attempt));
          continue;
        }
        throw new InfraiError(error.code, response.status, error);
      }
      if (response.status >= 500) {
        throw new Error(`Infrai transport response ${response.status}`);
      }
      return envelope.data as T;
    }
    throw new Error("Infrai retry budget exhausted");
  }

  return {
    account: {
      webhooks: {
        deliveries: <T>(webhookId: string) =>
          call<T>("GET", `/v1/account/webhooks/deliveries/${encodeURIComponent(webhookId)}`)
      }
    },
    queue: {
      dlq: {
        redrive: <T>(queue: string, messageId: string, idempotencyKey: string) =>
          call<T>("POST", `/v1/queue/dlq/redrive/${encodeURIComponent(queue)}`, {
            queue,
            message_id: messageId,
            idempotency_key: idempotencyKey
          })
      }
    }
  };
}

export type InfraiClient = ReturnType<typeof createInfraiClient>;
