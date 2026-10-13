/**
 * WC-CV-3 step 2 — retention lifecycle. Deletes each recording whose
 * delete_after (started_at + plan retention) has passed, and logs every attempt
 * in camv_recording_deletions. A deletion counts only when a HEAD afterwards
 * reads 404 (CC-70: "absent from R2 and present in the deletion log").
 */
import type { Queryable } from '../db';
import type { ObjectStore } from '../r2';
import { dueRecordings, logDeletion, type DueRecording } from './repo';

export type RetentionRunResult = {
  runId: string;
  dryRun: boolean;
  due: number;
  deleted: number;
  alreadyAbsent: number;
  failed: number;
  items: {
    recordingId: string;
    orgId: string;
    objectKey: string;
    outcome: string;
    r2Status: number | null;
  }[];
};

export async function runRetention(
  db: Queryable,
  store: ObjectStore,
  opts: { now?: Date; limit?: number; dryRun?: boolean; runId: string },
): Promise<RetentionRunResult> {
  const now = opts.now ?? new Date();
  const due = await dueRecordings(db, now, opts.limit ?? 500);
  const result: RetentionRunResult = {
    runId: opts.runId,
    dryRun: !!opts.dryRun,
    due: due.length,
    deleted: 0,
    alreadyAbsent: 0,
    failed: 0,
    items: [],
  };
  for (const rec of due) {
    if (opts.dryRun) {
      result.items.push({
        recordingId: rec.id,
        orgId: rec.orgId,
        objectKey: rec.objectKey,
        outcome: 'would_delete',
        r2Status: null,
      });
      continue;
    }
    const { outcome, status, detail } = await deleteOne(store, rec);
    await logDeletion(db, rec, opts.runId, outcome, status, detail);
    if (outcome === 'deleted') result.deleted++;
    else if (outcome === 'already_absent') result.alreadyAbsent++;
    else result.failed++;
    result.items.push({
      recordingId: rec.id,
      orgId: rec.orgId,
      objectKey: rec.objectKey,
      outcome,
      r2Status: status,
    });
  }
  return result;
}

async function deleteOne(
  store: ObjectStore,
  rec: DueRecording,
): Promise<{
  outcome: 'deleted' | 'already_absent' | 'failed';
  status: number | null;
  detail: string | null;
}> {
  try {
    const before = await store.head(rec.bucket, rec.objectKey);
    if (before === 404) return { outcome: 'already_absent', status: 404, detail: null };
    if (before !== 200)
      return { outcome: 'failed', status: before, detail: `HEAD before delete returned ${before}` };
    const del = await store.remove(rec.bucket, rec.objectKey);
    if (del !== 204 && del !== 200)
      return { outcome: 'failed', status: del, detail: `DELETE returned ${del}` };
    const after = await store.head(rec.bucket, rec.objectKey);
    if (after !== 404)
      return {
        outcome: 'failed',
        status: after,
        detail: `object still present after DELETE (HEAD ${after})`,
      };
    return { outcome: 'deleted', status: del, detail: null };
  } catch (e) {
    return {
      outcome: 'failed',
      status: null,
      detail: e instanceof Error ? e.message.slice(0, 300) : 'unknown error',
    };
  }
}
