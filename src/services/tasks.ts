import { AppError } from '../core/errors.js';
import { publishEvent } from '../core/events.js';
import { newId } from '../core/ids.js';
import { nowIso } from '../core/time.js';
import type { Runtime } from './runtime.js';
import { dedupCheck } from './dedup.js';

export interface TaskRow {
  taskId: string;
  type: string;
  status: string;
  progressDone: number;
  progressTotal: number;
  result: unknown;
  error: string | null;
  accountId: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  params?: Record<string, unknown>;
}

function rowToTask(row: Record<string, unknown>): TaskRow {
  return {
    taskId: String(row.task_id),
    type: String(row.type),
    status: String(row.status),
    progressDone: Number(row.progress_done ?? 0),
    progressTotal: Number(row.progress_total ?? 0),
    result: row.result_json ? JSON.parse(String(row.result_json)) : null,
    error: (row.error as string | null) ?? null,
    accountId: (row.account_id as string | null) ?? null,
    createdAt: String(row.created_at),
    startedAt: (row.started_at as string | null) ?? null,
    finishedAt: (row.finished_at as string | null) ?? null,
    params: JSON.parse(String(row.params_json ?? '{}')) as Record<string, unknown>
  };
}

export function createTask(rt: Runtime, input: { type: string; params: Record<string, unknown>; accountId?: string; idempotencyKey?: string; total?: number }): TaskRow {
  if (input.idempotencyKey) {
    const existing = rt.store.get<Record<string, unknown>>('SELECT * FROM tasks WHERE idempotency_key=?', input.idempotencyKey);
    if (existing) return rowToTask(existing);
  }
  const taskId = newId('task');
  rt.store.run(
    `INSERT INTO tasks(task_id,type,params_json,idempotency_key,status,progress_total,account_id,created_at)
     VALUES(?,?,?,?,'queued',?,?,?)`,
    taskId, input.type, JSON.stringify(input.params), input.idempotencyKey ?? null, input.total ?? 0, input.accountId ?? null, nowIso()
  );
  publishEvent(rt, { type: 'task.state.changed', accountId: input.accountId ?? null, entityType: 'task', entityId: taskId, payload: { taskId, from: null, to: 'queued' } });
  return getTask(rt, taskId);
}

export function getTask(rt: Runtime, taskId: string): TaskRow {
  const row = rt.store.get<Record<string, unknown>>('SELECT * FROM tasks WHERE task_id=?', taskId);
  if (!row) throw new AppError('not_found', `任务不存在: ${taskId}`);
  return rowToTask(row);
}

export function listTasks(rt: Runtime, input: { status?: string; type?: string; page?: number; pageSize?: number }): { list: TaskRow[]; totalNum: number } {
  const where: string[] = [];
  const params: unknown[] = [];
  if (input.status) { where.push('status=?'); params.push(input.status); }
  if (input.type) { where.push('type=?'); params.push(input.type); }
  const w = where.length ? ` WHERE ${where.join(' AND ')}` : '';
  const pageSize = Math.min(100, Math.max(1, input.pageSize ?? 20));
  const page = Math.max(1, input.page ?? 1);
  const rows = rt.store.all<Record<string, unknown>>(`SELECT * FROM tasks${w} ORDER BY created_at DESC LIMIT ? OFFSET ?`, ...params, pageSize, (page - 1) * pageSize);
  const total = rt.store.get<{ c: number }>(`SELECT COUNT(*) AS c FROM tasks${w}`, ...params);
  return { list: rows.map(rowToTask), totalNum: Number(total?.c ?? 0) };
}

export function updateTask(rt: Runtime, taskId: string, patch: { status?: string; progressDone?: number; progressTotal?: number; result?: unknown; error?: string | null }): void {
  const fields: string[] = [];
  const values: unknown[] = [];
  if (patch.status !== undefined) { fields.push('status=?'); values.push(patch.status); }
  if (patch.progressDone !== undefined) { fields.push('progress_done=?'); values.push(patch.progressDone); }
  if (patch.progressTotal !== undefined) { fields.push('progress_total=?'); values.push(patch.progressTotal); }
  if (patch.result !== undefined) { fields.push('result_json=?'); values.push(JSON.stringify(patch.result)); }
  if (patch.error !== undefined) { fields.push('error=?'); values.push(patch.error); }
  if (patch.status === 'running') { fields.push('started_at=?'); values.push(nowIso()); }
  if (patch.status === 'succeeded' || patch.status === 'failed' || patch.status === 'cancelled') { fields.push('finished_at=?'); values.push(nowIso()); }
  if (!fields.length) return;
  values.push(taskId);
  rt.store.run(`UPDATE tasks SET ${fields.join(',')} WHERE task_id=?`, ...values);
}

export function cancelTask(rt: Runtime, taskId: string): TaskRow {
  const row = getTask(rt, taskId);
  if (['succeeded', 'failed', 'cancelled'].includes(row.status)) throw new AppError('conflict', `任务已结束: ${row.status}`);
  rt.store.run(`UPDATE tasks SET status='cancelled', finished_at=? WHERE task_id=?`, nowIso(), taskId);
  publishEvent(rt, { type: 'task.state.changed', accountId: row.accountId, entityType: 'task', entityId: taskId, payload: { taskId, from: row.status, to: 'cancelled' } });
  return getTask(rt, taskId);
}

/* ---------------- 批量查重任务 ---------------- */
export function createDedupBatch(rt: Runtime, input: { keywords: string[]; accountId?: string; idempotencyKey?: string; chunkSize?: number }): TaskRow {
  const keywords = (input.keywords ?? []).map((k) => String(k).trim()).filter(Boolean);
  if (!keywords.length) throw new AppError('invalid_argument', 'keywords 不能为空');
  const task = createTask(rt, {
    type: 'dedup_batch',
    params: { keywords, accountId: input.accountId ?? null },
    accountId: input.accountId,
    idempotencyKey: input.idempotencyKey,
    total: keywords.length
  });
  setImmediate(() => { void runDedupBatchTask(rt, task.taskId).catch(() => undefined); });
  return task;
}

export async function runDedupBatchTask(rt: Runtime, taskId: string): Promise<void> {
  const task = getTask(rt, taskId);
  if (task.status !== 'queued') return;
  updateTask(rt, taskId, { status: 'running' });
  publishEvent(rt, { type: 'task.state.changed', accountId: task.accountId, entityType: 'task', entityId: taskId, payload: { taskId, from: 'queued', to: 'running' } });
  const keywords = (task.params?.keywords as string[]) ?? [];
  const accountId = (task.params?.accountId as string | undefined) ?? undefined;
  const items: Array<{ keywords: string; count: number }> = [];
  let done = 0;
  try {
    for (const keywordsItem of keywords) {
      const current = getTask(rt, taskId);
      if (current.status === 'cancelled') return;
      const r = await dedupCheck(rt, { accountId, keywords: keywordsItem });
      items.push({ keywords: keywordsItem, count: r.count });
      rt.store.run(
        `INSERT INTO task_items(task_id,item_index,item_key,status,result_json,updated_at) VALUES(?,?,?,?,?,?)`,
        taskId, done, keywordsItem, 'succeeded', JSON.stringify({ count: r.count }), nowIso()
      );
      done++;
      updateTask(rt, taskId, { progressDone: done });
    }
    const summary = { total: keywords.length, hits: items.filter((i) => i.count > 0).length, items };
    updateTask(rt, taskId, { status: 'succeeded', progressDone: done, result: summary });
    publishEvent(rt, { type: 'task.state.changed', accountId: task.accountId, entityType: 'task', entityId: taskId, payload: { taskId, from: 'running', to: 'succeeded' } });
    if (items.some((i) => i.count > 0)) {
      publishEvent(rt, { type: 'dedup.result.changed', accountId: task.accountId, entityType: 'task', entityId: taskId, payload: { taskId, hits: items.filter((i) => i.count > 0) } });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    updateTask(rt, taskId, { status: 'failed', error: msg.slice(0, 500) });
    publishEvent(rt, { type: 'task.state.changed', accountId: task.accountId, entityType: 'task', entityId: taskId, payload: { taskId, from: 'running', to: 'failed', error: msg.slice(0, 300) } });
  }
}

/** 重启恢复：执行 queued 任务。 */
export async function processQueuedTasks(rt: Runtime, limit = 3): Promise<number> {
  const rows = rt.store.all<{ task_id: string; type: string }>("SELECT task_id, type FROM tasks WHERE status='queued' ORDER BY created_at ASC LIMIT ?", limit);
  for (const row of rows) {
    if (row.type === 'dedup_batch') await runDedupBatchTask(rt, row.task_id).catch(() => undefined);
  }
  return rows.length;
}
