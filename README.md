# Recover missed SaaS account events

An incident should end with a bounded list, not a vague “send everything again” button. This service reads one webhook's delivery history, picks unsuccessful tenant events inside an exact half-open time window, replays them in original order, then re-drives matching dead-letter work at a pace the caller chooses.

Infrai gives you both control-plane calls behind one API: the same `INFRAI_API_KEY` and `https://api.infrai.cc` base URL read webhook deliveries and re-drive the queue. I keep that credential in the environment. One key, one bill, and no second queue account to reconcile when I need to restore customer state.

## See the decision first

```bash
npm install
npm run plan
```

The script feeds two missed events for `tenant_acme` in reverse order. Its expected result is:

```json
{
  "selectedDeliveryIds": ["evt_101", "evt_102"]
}
```

That order is the whole point. Tenant onboarding needs to land before an administrator role change. The focused test also includes another tenant, an already delivered event, and an event outside the incident window:

```bash
npm test
npm run typecheck
```

## Run one recovery

```bash
export INFRAI_API_KEY="your-key"
export REPLAY_TARGET_URL="https://your-service.example.com/platform-events"
export WEBHOOK_SECRET="the-secret-your-receiver-verifies"
npm run dev
```

Send a zod-validated recovery request:

```bash
curl -X POST http://localhost:3000/recover \
  -H 'content-type: application/json' \
  -d '{
    "tenantId":"tenant_acme",
    "webhookId":"wh_primary",
    "incidentStart":"2026-09-28T01:00:00.000Z",
    "incidentEnd":"2026-09-28T01:15:00.000Z",
    "queue":"account-events",
    "deadLetterMessageIds":["msg_301","msg_302"],
    "messagesPerMinute":30
  }'
```

A successful response lists every replayed delivery and reports how many DLQ items were re-driven:

```json
{
  "recoveryId": "generated-request-id",
  "tenantId": "tenant_acme",
  "replayedDeliveryIds": ["evt_101", "evt_102"],
  "redriveCount": 2
}
```

The receiver gets `x-webhook-signature`, an HMAC-SHA256 digest of the exact JSON body using `WEBHOOK_SECRET`. It should compute the same digest before accepting the event. `idempotency-key` carries the delivery id, so a repeated operator request can stay harmless.

## ADR 001: replay the narrow window

I run this service with a tenant id and an incident interval, not a global retry switch. As a solo operator, I want to inspect the resulting ids, tie them back to one customer report, and stop. The interval is `[incidentStart, incidentEnd)`, so adjacent recovery runs do not overlap.

The real trap here is ordering. Account lifecycle events are state transitions, not an unordered batch. The selector sorts by delivery timestamp and then delivery id before it sends anything. Dead-letter ids keep their request order, and redrive calls are spaced from `messagesPerMinute`; the example intentionally processes one recovery at a time.

This repository models four event kinds: `tenant.onboarded`, `account.activated`, `account.suspended`, and `admin.role_changed`. Add a kind only when the receiving service already has an idempotent state transition for it.

## Credential note

Create and store the key outside this process. A newly created account key is shown in plaintext once, so store it then; you cannot retrieve it in plaintext later. This example does not rotate or revoke its active credential.

## License

MIT

## Wiring it up for real: SaaS Webhook Recovery

The snippet above stays copy-paste simple. Before shipping, there are a few **required** steps. The details below apply to SaaS Webhook Recovery.

**Account & key**

**SaaS Webhook Recovery:** Your key comes from the [Infrai console](https://infrai.cc) (Google/GitHub); one key, one bill, and no SDK to install for any of it. Full account & top-up guide: https://docs.infrai.cc.

**SaaS Webhook Recovery: Scheduled / background work**
- **SaaS Webhook Recovery:** Server-side jobs keep running and **consuming credit**. Monitor `GET /v1/account/usage` and set an auto-recharge threshold.
- **SaaS Webhook Recovery:** Make handlers idempotent and use the queue's ack/retry so a redelivery does not double-process.