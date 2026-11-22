import { db } from "@/lib/db";
import { jobs } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import { randomUUID } from "crypto";

export type JobType =
  | "PROCESS_PSD"
  | "CLEANUP_ORPHANS"
  | "PURGE_DELETED_EVENTS"
  | "PURGE_ANALYTICS";

export interface ProcessPsdPayload {
  psdVersionId: string;
  eventId: string;
  eventFormatId: string;
}

export interface EnqueueJobOptions {
  runAt?: Date;
  maxAttempts?: number;
}

export async function enqueueJob<T = Record<string, unknown>>(
  type: JobType | string,
  payload: T,
  options: EnqueueJobOptions = {}
): Promise<string> {
  const id = randomUUID();
  await db.insert(jobs).values({
    id,
    type,
    payload: payload as Record<string, unknown>,
    status: "pending",
    attempts: 0,
    maxAttempts: options.maxAttempts ?? 3,
    runAt: options.runAt ?? new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  return id;
}

export interface ClaimedJob {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  attempts: number;
  maxAttempts: number;
}

export async function claimNextJob(workerId: string): Promise<ClaimedJob | null> {
  const query = sql`
    WITH next_job AS (
      SELECT id FROM ${jobs}
      WHERE (${jobs.status} = 'pending' OR (${jobs.status} = 'running' AND ${jobs.lockedAt} < NOW() - INTERVAL '5 minutes'))
        AND ${jobs.runAt} <= NOW()
        AND ${jobs.attempts} < ${jobs.maxAttempts}
      ORDER BY ${jobs.runAt} ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    UPDATE ${jobs}
    SET
      status = 'running',
      locked_at = NOW(),
      locked_by = ${workerId},
      attempts = ${jobs.attempts} + 1,
      updated_at = NOW()
    FROM next_job
    WHERE ${jobs.id} = next_job.id
    RETURNING ${jobs.id}, ${jobs.type}, ${jobs.payload}, ${jobs.attempts}, ${jobs.maxAttempts};
  `;

  const result = await db.execute(query);
  const rows = result.rows as unknown as ClaimedJob[];
  return rows[0] ?? null;
}

export async function completeJob(id: string): Promise<void> {
  await db
    .update(jobs)
    .set({
      status: "completed",
      lockedAt: null,
      lockedBy: null,
      updatedAt: new Date(),
    })
    .where(eq(jobs.id, id));
}

export async function failJob(
  id: string,
  errorMessage: string,
  attempts: number,
  maxAttempts: number
): Promise<void> {
  const hasMoreAttempts = attempts < maxAttempts;
  const backoffSeconds = Math.min(60 * 15, Math.pow(2, attempts) * 5);
  const nextRunAt = new Date(Date.now() + backoffSeconds * 1000);

  await db
    .update(jobs)
    .set({
      status: hasMoreAttempts ? "pending" : "failed",
      error: errorMessage,
      runAt: hasMoreAttempts ? nextRunAt : new Date(),
      lockedAt: null,
      lockedBy: null,
      updatedAt: new Date(),
    })
    .where(eq(jobs.id, id));
}
