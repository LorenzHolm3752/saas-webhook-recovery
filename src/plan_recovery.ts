import { recoveryRequestSchema, selectMissedDeliveries } from "./recovery_plan.js";

const request = recoveryRequestSchema.parse({
  tenantId: "tenant_acme",
  webhookId: "wh_primary",
  incidentStart: "2026-09-28T01:00:00.000Z",
  incidentEnd: "2026-09-28T01:15:00.000Z",
  queue: "account-events",
  deadLetterMessageIds: ["msg_301", "msg_302"],
  messagesPerMinute: 30
});

const selected = selectMissedDeliveries([
  {
    id: "evt_102",
    tenant_id: "tenant_acme",
    event_type: "admin.role_changed",
    status: "pending",
    created_at: "2026-09-28T01:08:00.000Z",
    payload: { adminId: "usr_7", role: "owner" }
  },
  {
    id: "evt_101",
    tenant_id: "tenant_acme",
    event_type: "tenant.onboarded",
    status: "failed",
    created_at: "2026-09-28T01:03:00.000Z",
    payload: { plan: "team" }
  }
], request);

console.log(JSON.stringify({ selectedDeliveryIds: selected.map(({ id }) => id) }, null, 2));
