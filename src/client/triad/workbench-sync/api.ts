/**
 * 工作台资产云端双向同步前端 API 请求。
 */

import type {
  SyncProgress,
  WorkbenchSyncPatch,
  WorkbenchSyncPublic,
  WorkbenchSyncRun,
} from '../../../triad/workbench-sync/types.js'

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const resp = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) },
    ...options,
  })
  if (!resp.ok) {
    const body = await resp.json().catch(() => null) as { error?: string } | null
    throw new Error(body?.error || `HTTP ${resp.status}`)
  }
  return resp.json() as Promise<T>
}

export async function fetchSyncStatus(): Promise<WorkbenchSyncPublic> {
  const data = await request<{ ok: boolean; status: WorkbenchSyncPublic }>('/api/triad/workbench-sync/status')
  return data.status
}

export async function fetchSyncProgress(): Promise<{ progress: SyncProgress | null; running: boolean }> {
  return request<{ ok: boolean; progress: SyncProgress | null; running: boolean }>('/api/triad/workbench-sync/progress')
}

export async function saveSyncSettings(patch: WorkbenchSyncPatch): Promise<WorkbenchSyncPublic> {
  const data = await request<{ ok: boolean; status: WorkbenchSyncPublic }>('/api/triad/workbench-sync/save', {
    method: 'POST',
    body: JSON.stringify(patch),
  })
  return data.status
}

export async function triggerSyncUpload(): Promise<{ run: WorkbenchSyncRun; status: WorkbenchSyncPublic }> {
  return request<{ ok: boolean; run: WorkbenchSyncRun; status: WorkbenchSyncPublic }>('/api/triad/workbench-sync/upload-now', {
    method: 'POST',
  })
}

export async function triggerSyncPull(): Promise<{ run: WorkbenchSyncRun; status: WorkbenchSyncPublic }> {
  return request<{ ok: boolean; run: WorkbenchSyncRun; status: WorkbenchSyncPublic }>('/api/triad/workbench-sync/pull-now', {
    method: 'POST',
  })
}
