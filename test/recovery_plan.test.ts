import assert from "node:assert/strict";
import test from "node:test";
import { recoveryRequestSchema, selectMissedDeliveries } from "../src/recovery_plan.js";

test("replays only this tenant's unsuccessful deliveries inside the incident window", () => {
  const request = recoveryRequestSchema.parse({
    tenantId: "tenant_a",
    webhookId: "wh_1",
    incidentStart: "2026-09-28T10:00:00.000Z",
    incidentEnd: "2026-09-28T10:10:00.000Z",
    queue: "lifecycle-events",
    deadLetterMessageIds: ["msg_1"],
    messagesPerMinute: 20
  });
  const base = {
    event_type: "account.activated" as const,
    payload: { accountId: "acct_9" }
  };

  const selected = selectMissedDeliveries([
    { ...base, id: "late", tenant_id: "tenant_a", status: "pending", created_at: "2026-09-28T10:09:00.000Z" },
    { ...base, id: "other-tenant", tenant_id: "tenant_b", status: "failed", created_at: "2026-09-28T10:03:00.000Z" },
    { ...base, id: "delivered", tenant_id: "tenant_a", status: "delivered", created_at: "2026-09-28T10:04:00.000Z" },
    { ...base, id: "early", tenant_id: "tenant_a", status: "failed", created_at: "2026-09-28T10:02:00.000Z" },
    { ...base, id: "outside", tenant_id: "tenant_a", status: "failed", created_at: "2026-09-28T10:11:00.000Z" }
  ], request);

  assert.deepEqual(selected.map(({ id }) => id), ["early", "late"]);
});
