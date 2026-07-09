import { db, type Db } from "../db/client";
import { mutationAuditLog } from "../db/schema";
import { redactValue } from "../security/redact";

/**
 * Mutation audit log — every write tool records exactly one row per attempt,
 * success or failure (docs/PLAN.md §"MCP surface"). Payloads are redacted
 * before insert; audit rows must never contain tokens.
 */

export interface MutationAuditEntry {
  userId?: string;
  toolName: string;
  dataType: string;
  operation: "create" | "update" | "delete";
  requestPayload: unknown;
  responsePayload?: unknown;
  googleDataPointName?: string;
  status: "success" | "error";
  errorMessage?: string;
}

export async function recordMutation(
  entry: MutationAuditEntry,
  database: Db = db,
): Promise<void> {
  await database.insert(mutationAuditLog).values({
    userId: entry.userId,
    toolName: entry.toolName,
    dataType: entry.dataType,
    operation: entry.operation,
    requestPayload: redactValue(entry.requestPayload) ?? {},
    responsePayload:
      entry.responsePayload === undefined ? null : redactValue(entry.responsePayload),
    googleDataPointName: entry.googleDataPointName,
    status: entry.status,
    errorMessage: entry.errorMessage,
  });
}
