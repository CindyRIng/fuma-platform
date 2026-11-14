import { poolOf } from '../pool/request-pool.js';
import { nowIso } from '../core/time.js';
import type { Runtime } from './runtime.js';
import { createDedupBatch, createTask, getTask, listTasks, cancelTask, updateTask, runDedupBatchTask, processQueuedTasks } from './tasks.js';
import { claim, createContact, createCustomer, createFollowup, deleteCustomer, release, syncStatus, updateCustomer } from './writes.js';
import { listEvents } from '../core/events.js';
import { processOutboxOnce, reconcileCustomers, retryOutbox, syncStatusDetail } from './sync.js';

/** 供 dispatch 复用的业务门面（薄层）。 */
export {
  claim, release, createCustomer, updateCustomer, deleteCustomer, createFollowup, createContact,
  createDedupBatch, createTask, getTask, listTasks, cancelTask, updateTask, runDedupBatchTask, processQueuedTasks,
  listEvents, processOutboxOnce, reconcileCustomers, retryOutbox, syncStatus, syncStatusDetail
};

export function poolStatus(rt: Runtime): unknown {
  return poolOf(rt).stats();
}

export function touchSyncRun(rt: Runtime): void {
  rt.store.setKv('sync:lastRun', { at: nowIso() });
}
