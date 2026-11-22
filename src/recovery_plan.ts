import { z } from "zod";

export const recoveryRequestSchema = z.object({
  tenantId: z.string().min(1),
  webhookId: z.string().min(1),
  incidentStart: z.string().datetime(),
  incidentEnd: z.string().datetime(),
  queue: z.string().min(1),
  deadLetterMessageIds: z.array(z.string().min(1)).min(1).max(500),
  messagesPerMinute: z.number().int().min(1).max(120)
}).refine(
  ({ incidentStart, incidentEnd }) => Date.parse(incidentStart) < Date.parse(incidentEnd),
  { message: "incidentEnd must be after incidentStart", path: ["incidentEnd"] }
);

export type RecoveryRequest = z.infer<typeof recoveryRequestSchema>;

export const deliverySchema = z.object({
  id: z.string(),
  tenant_id: z.string(),
  event_type: z.enum([
    "tenant.onboarded",
    "account.activated",
    "account.suspended",
    "admin.role_changed"
  ]),
  status: z.string(),
  created_at: z.string().datetime(),
  payload: z.record(z.unknown())
});

export type Delivery = z.infer<typeof deliverySchema>;

const successfulStatuses = new Set(["delivered", "succeeded"]);

export function selectMissedDeliveries(
  deliveries: Delivery[],
  request: RecoveryRequest
): Delivery[] {
  const start = Date.parse(request.incidentStart);
  const end = Date.parse(request.incidentEnd);

  return deliveries
    .filter((delivery) =>
      delivery.tenant_id === request.tenantId &&
      !successfulStatuses.has(delivery.status) &&
      Date.parse(delivery.created_at) >= start &&
      Date.parse(delivery.created_at) < end
    )
    .sort((left, right) =>
      left.created_at.localeCompare(right.created_at) || left.id.localeCompare(right.id)
    );
}
