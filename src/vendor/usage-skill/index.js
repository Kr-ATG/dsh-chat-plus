import { apply as applySkills } from './skills-host.js';
/**
 * dsh-usage-skill — server half.
 *
 * Registers five read-only, loopback-only endpoints on the web server:
 *   GET /api/usage-stats/usage         — per-day token usage across every session
 *   GET /api/usage-stats/providers     — configured providers + balance schemes
 *   GET /api/usage-stats/balance       — balance for one provider (?provider=<id>)
 *   GET /api/usage-stats/subscriptions — OpenCode Go + Z.ai quota windows
 *   GET /api/usage-stats/account       — unified account snapshot for one provider
 *
 * Provider configuration is read straight from the harness settings
 * (`llm-deepseek` for the official DeepSeek route, `llm-pi-ai` for every
 * configured pi-ai provider profile), and each provider's API key is resolved
 * through the credentials seam at request time — nothing is stored by this
 * plugin.
 *
 * The endpoints live under the `/api` prefix as exact routes, so they win
 * over the connection plugin's `/api` prefix handler; each handler applies
 * its own peer-socket loopback fence (the exact routes bypass the RPC trust
 * fence); Host is checked only as an additional defense.
 *
 * Usage aggregation is INCREMENTAL: per-session fold state (day/model
 * buckets plus the last usage sample) is cached in memory and persisted to
 * `<DSH_HOME>/storages/usage-stats-cache.json`. On each request only the
 * events added since the last fold are processed — live sessions fold their
 * in-memory tail, while persisted sessions use the storage backend's opaque
 * revision when available. Steady-state cost stays O(new events) no matter
 * how large the logs grow: measured 3–49ms per pass over 1400+ stored
 * sessions, and a corpus growing to 3000 sessions does not change that.
 *
 * Why this does not read the harness's own projection cache, after checking:
 * `ctx.sessionProjectionCache.cachedSnapshot` really is a zero-I/O memory-table
 * read, and it is what `api-session.list` uses. But it only serves units that
 * declared a `wire` — `SessionProjections.viewCheckpoint` opens with
 * `if (def.wire === undefined) continue`, so the host-only registration
 * overload (no wire) is invisible to every cold read. Giving this unit a wire
 * to become readable would push each session's whole per-day breakdown into
 * every `session list` payload the browser fetches (~1.6MB at 1250 sessions),
 * to buy back a cost this file already avoids: the expensive path here is a
 * CACHE MISS, and a miss needs a full decompression pass whatever wrote the
 * rows last. The cache on disk is what makes the common case free, and it is
 * written here, where the identity and watermark bookkeeping that matters
 * (see `foldPersistedSession`) already lives.
 *
 * @module dsh-usage-skill
 */

import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { applyUsageDelta, createUsageState, mergeInto, renderSignal, renderUsage, totalTokens, zeroBuckets } from "./usage.js";
import { ACCOUNT_REFRESH_MS, createAccountService, validateAccountConfig } from "./accounts.js";
import { queryDeepseekBilling } from "./deepseek-billing.js";

/** Stable Cordis plugin name. */
const name = "usage-stats";

/** Services required before this plugin activates. */
const inject = ["webServer", "credentials", "sessions", "sessionPersistence", "settings", "llm"];

const USAGE_PATH = "/api/usage-stats/usage";
const SIGNAL_PATH = "/api/usage-stats/signal";
const DAY_SESSIONS_PATH = "/api/usage-stats/day-sessions";
const BUDGET_PATH = "/api/usage-stats/budget";
const PROVIDERS_PATH = "/api/usage-stats/providers";
const BALANCE_PATH = "/api/usage-stats/balance";
const SUBSCRIPTIONS_PATH = "/api/usage-stats/subscriptions";
const ACCOUNT_PATH = "/api/usage-stats/account";
const CREDENTIALS_PATH = "/api/usage-stats/credentials";
const BILLING_PATH = "/api/usage-stats/deepseek-billing";
const UPSTREAM_TIMEOUT_MS = 15000;
// v7: the per-hour fold and the per-step interval lists are gone. Neither fed
// anything a client reads — together they were 72% of the response body and
// the bulk of the 4.5MB persisted cache, re-serialized and re-merged on every
// aggregation pass. Bumping forces one full refold, after which the cache
// settles at a few hundred KB and each pass stops paying for them.
const CACHE_VERSION = 7;

/** Credential references the in-panel editor may write (SenseNova console login). */
const WRITABLE_CREDENTIAL_REFS = new Set(["SENSENOVA_USERNAME", "SENSENOVA_PASSWORD", "SENSENOVA_CONSOLE_TOKEN", "DEEPSEEK_USER_TOKEN"]);

/** Default DeepSeek connection facts when the settings namespace is absent. */
const DEEPSEEK_DEFAULTS = {
	apiKeyEnv: "DEEPSEEK_API_KEY",
	baseURL: "https://api.deepseek.com"
};

/** Write a JSON response. */
function json(res, status, value) {
	const body = JSON.stringify(value);
	res.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"cache-control": "no-cache"
	});
	res.end(body);
}

/**
 * Loopback fence, primary on the PEER SOCKET address (not the
 * client-controllable Host header): the request must come from a loopback
 * interface. IPv4-mapped IPv6 (`::ffff:127.0.0.1`) is normalized. The Host
 * header is kept as an additional check, never as the deciding one.
 */
function isLoopbackAddress(address) {
	if (typeof address !== "string") return false;
	const a = address.toLowerCase();
	if (a === "::1") return true;
	const ipv4 = a.startsWith("::ffff:") ? a.slice(7) : a;
	const octets = ipv4.split(".");
	return octets.length === 4 && octets[0] === "127" && octets.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}

/** Parse a Host header without breaking bracketed or bare IPv6 literals. */
function hostNameOf(value) {
	if (typeof value !== "string") return null;
	const host = value.trim().toLowerCase();
	if (host.startsWith("[")) {
		const close = host.indexOf("]");
		if (close <= 1) return null;
		const suffix = host.slice(close + 1);
		if (suffix !== "" && !/^:\d+$/.test(suffix)) return null;
		return host.slice(1, close);
	}
	const firstColon = host.indexOf(":");
	const lastColon = host.lastIndexOf(":");
	if (firstColon !== lastColon) return host;
	if (lastColon === -1) return host.replace(/\.$/, "");
	if (!/^\d+$/.test(host.slice(lastColon + 1))) return null;
	return host.slice(0, lastColon).replace(/\.$/, "");
}

function isLoopbackHostHeader(req) {
	const name = hostNameOf(req.headers.host);
	return name === "localhost" || isLoopbackAddress(name);
}

/** Refuse non-loopback callers and non-GET methods before any work. */
function rejectForeignCaller(req, res) {
	if (req.method !== "GET") {
		res.writeHead(405, { "content-type": "application/json; charset=utf-8" });
		res.end(JSON.stringify({ ok: false, error: "method-not-allowed" }));
		return true;
	}
	const peer = req.socket?.remoteAddress;
	if (isLoopbackAddress(peer) && isLoopbackHostHeader(req)) return false;
	json(res, 403, { ok: false, error: "forbidden" });
	return true;
}

/** Refuse non-loopback callers only (the credential editor accepts POST). */
function rejectForeignWrite(req, res) {
	const peer = req.socket?.remoteAddress;
	if (isLoopbackAddress(peer) && isLoopbackHostHeader(req)) return false;
	json(res, 403, { ok: false, error: "forbidden" });
	return true;
}

/** Read a JSON request body with a hard size cap (secret values included). */
function readJsonBody(req, maxBytes = 64 * 1024) {
	return new Promise((resolve, reject) => {
		const chunks = [];
		let size = 0;
		req.on("data", (chunk) => {
			size += chunk.length;
			if (size > maxBytes) {
				reject(new Error("request body exceeds the size limit"));
				req.destroy();
				return;
			}
			chunks.push(chunk);
		});
		req.on("end", () => {
			try {
				resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
			} catch {
				reject(new Error("request body is not valid JSON"));
			}
		});
		req.on("error", reject);
	});
}

//#region incremental cache
/** Cache file location under the dsh home. */
function cachePath() {
	const home = process.env.DSH_HOME ?? join(homedir(), ".dsh");
	return join(home, "storages", "usage-stats-cache.json");
}

let loadedCache = null;
let loadPromise = null;
let inflight = null;

/** Serialize one session's fold state (Maps → plain objects). */
function serializeSession(state) {
	const days = {};
	for (const [date, entry] of state.days) {
		const models = {};
		for (const [model, buckets] of entry.models) models[model] = { ...buckets };
		days[date] = {
			totals: { ...entry.totals },
			models,
			requests: entry.requests ?? 0,
			compacted: entry.compacted ?? 0
		};
	}
	return {
		kind: state.kind ?? "persisted",
		consumed: state.consumed ?? 0,
		...(state.revision === void 0 ? {} : { revision: state.revision }),
		...(typeof state.title === "string" ? { title: state.title } : {}),
		days,
		lastSample: state.lastSample === null ? null : {
			key: state.lastSample.key,
			day: state.lastSample.day,
			hour: state.lastSample.hour,
			model: state.lastSample.model,
			buckets: { ...state.lastSample.buckets }
		},
		currentModel: state.currentModel,
		openSteps: state.openSteps instanceof Map ? Object.fromEntries(state.openSteps) : {}
	};
}

/** Parse a serialized session entry back into fold state (lenient). */
function parseSession(raw) {
	const state = createUsageState();
	if (raw === null || typeof raw !== "object") return state;
	state.kind = typeof raw.kind === "string" ? raw.kind : "persisted";
	state.consumed = Number.isSafeInteger(raw.consumed) ? raw.consumed : 0;
	if (typeof raw.revision === "string") state.revision = raw.revision;
	if (typeof raw.title === "string") state.title = raw.title;
	if (raw.days !== null && typeof raw.days === "object") {
		for (const [date, entry] of Object.entries(raw.days)) {
			if (entry === null || typeof entry !== "object") continue;
			const target = { totals: zeroBuckets(), models: new Map(), requests: 0, compacted: 0 };
			const totals = entry.totals;
			if (totals !== null && typeof totals === "object") {
				target.totals.inputTokens = Number.isFinite(totals.inputTokens) ? totals.inputTokens : 0;
				target.totals.outputTokens = Number.isFinite(totals.outputTokens) ? totals.outputTokens : 0;
				target.totals.cacheReadTokens = Number.isFinite(totals.cacheReadTokens) ? totals.cacheReadTokens : 0;
				target.totals.cacheWriteTokens = Number.isFinite(totals.cacheWriteTokens) ? totals.cacheWriteTokens : 0;
			}
			if (Number.isFinite(entry.requests)) target.requests = entry.requests;
			if (Number.isFinite(entry.compacted)) target.compacted = entry.compacted;
			if (entry.models !== null && typeof entry.models === "object") {
				for (const [model, buckets] of Object.entries(entry.models)) {
					if (buckets === null || typeof buckets !== "object") continue;
					target.models.set(model, {
						inputTokens: Number.isFinite(buckets.inputTokens) ? buckets.inputTokens : 0,
						outputTokens: Number.isFinite(buckets.outputTokens) ? buckets.outputTokens : 0,
						cacheReadTokens: Number.isFinite(buckets.cacheReadTokens) ? buckets.cacheReadTokens : 0,
						cacheWriteTokens: Number.isFinite(buckets.cacheWriteTokens) ? buckets.cacheWriteTokens : 0
					});
				}
			}
			state.days.set(date, target);
		}
	}
	if (raw.lastSample !== null && raw.lastSample !== void 0 && typeof raw.lastSample === "object" && typeof raw.lastSample.key === "string" && typeof raw.lastSample.day === "string") {
		const buckets = raw.lastSample.buckets ?? {};
		state.lastSample = {
			key: raw.lastSample.key,
			day: raw.lastSample.day,
			hour: typeof raw.lastSample.hour === "string" ? raw.lastSample.hour : void 0,
			model: typeof raw.lastSample.model === "string" ? raw.lastSample.model : "unknown",
			buckets: {
				inputTokens: Number.isFinite(buckets.inputTokens) ? buckets.inputTokens : 0,
				outputTokens: Number.isFinite(buckets.outputTokens) ? buckets.outputTokens : 0,
				cacheReadTokens: Number.isFinite(buckets.cacheReadTokens) ? buckets.cacheReadTokens : 0,
				cacheWriteTokens: Number.isFinite(buckets.cacheWriteTokens) ? buckets.cacheWriteTokens : 0
			}
		};
	}
	if (typeof raw.currentModel === "string") state.currentModel = raw.currentModel;
	if (raw.openSteps !== null && typeof raw.openSteps === "object") {
		for (const [key, time] of Object.entries(raw.openSteps)) {
			if (Number.isFinite(time)) state.openSteps.set(key, time);
		}
	}
	return state;
}

/** Load the cache once per process; any corruption degrades to a fresh cache. */
async function loadCache() {
	if (loadedCache !== null) return loadedCache;
	loadPromise ??= (async () => {
		const fresh = { version: CACHE_VERSION, sessions: {} };
		try {
			const raw = await readFile(cachePath(), "utf8");
			const parsed = JSON.parse(raw);
			if (parsed !== null && typeof parsed === "object" && parsed.version === CACHE_VERSION && parsed.sessions !== null && typeof parsed.sessions === "object") {
				const sessions = {};
				for (const [id, entry] of Object.entries(parsed.sessions)) {
					if (typeof id === "string" && id.length > 0) sessions[id] = parseSession(entry);
				}
				return { version: CACHE_VERSION, sessions };
			}
		} catch {
			/* first run or corrupt cache */
		}
		return fresh;
	})();
	loadedCache = await loadPromise;
	return loadedCache;
}

/** Persist the cache atomically (temp + rename); failures are logged, never fatal. */
async function saveCache(ctx, cache) {
	try {
		const path = cachePath();
		await mkdir(dirname(path), { recursive: true });
		const serialized = { version: CACHE_VERSION, sessions: {} };
		for (const [id, state] of Object.entries(cache.sessions)) serialized.sessions[id] = serializeSession(state);
		const tmp = `${path}.tmp`;
		await writeFile(tmp, JSON.stringify(serialized), "utf8");
		await rename(tmp, path);
	} catch (error) {
		ctx.logger.warn(`usage-stats: saving usage cache failed: ${String(error)}`);
	}
}

/** Single-flight guard: concurrent requests share one aggregation run. */
function withLock(run) {
	if (inflight !== null) return inflight;
	inflight = run().finally(() => {
		inflight = null;
	});
	return inflight;
}

/** Single-flight guard for the persisted-snapshot warm-up. */
let warmPromise = null;

/**
 * Populate {@link cachedUsageResult} from the persisted fold state alone.
 *
 * Runs before (and outside) {@link withLock} on purpose: it must not queue
 * behind an in-flight corpus scan, because its whole job is to give the caller
 * an answer while that scan is still running. `lastCollectTime` stays at 0 so
 * the warm snapshot is immediately considered overdue and the next non-forced
 * call schedules a real recompute instead of serving it for the full TTL.
 */
function warmSnapshot() {
	if (cachedUsageResult !== null) return Promise.resolve();
	warmPromise ??= (async () => {
		const cache = await loadCache();
		if (cachedUsageResult === null) cachedUsageResult = renderCachedSnapshot(cache);
	})().finally(() => {
		warmPromise = null;
	});
	return warmPromise;
}
//#endregion

/**
 * Read one persisted session's whole/delta event log across host generations.
 *
 * Older hosts expose `sessionPersistence.readFrom(id, fromSeq)`; DSH 0.1.5
 * replaced the persistence seam with per-session handles
 * (`open(id, "read")` → `handle.read(offset, length)` → `handle.close()`)
 * and removed `readFrom`/`listSnapshots` entirely. Feature-detect so one
 * bundle works on both.
 *
 * @param persistence - the `sessionPersistence` service.
 * @param id - stored session id.
 * @param offset - first logical seq to include (delta reads).
 * @returns caller-owned event array in seq order.
 */
async function readPersistedEvents(persistence, id, offset = 0) {
	if (typeof persistence.readFrom === "function") {
		const { events } = await persistence.readFrom(id, offset);
		return [...(events ?? [])];
	}
	const handle = await persistence.open(id, "read");
	try {
		const events = [];
		let cursor = offset;
		for (;;) {
			const slice = await handle.read(cursor, 2000);
			const batch = slice?.events ?? [];
			if (batch.length === 0) break;
			for (const event of batch) events.push(event);
			const last = batch[batch.length - 1];
			cursor = typeof last?.seq === "number" ? last.seq + 1 : cursor + batch.length;
			if (batch.length < 2000) break;
		}
		return events;
	} finally {
		try {
			await handle.close();
		} catch {
			/* teardown failure must not mask the read result */
		}
	}
}

/** Cache last rendered usage for quick response. */
let cachedUsageResult = null;
let lastCollectTime = 0;
const USAGE_COLLECT_TTL_MS = 15000;

/**
 * How many session logs may be open at once during a fold pass.
 *
 * The backend stores one zstd frame per event, so reading a log is whole-file
 * work no matter how few events are new. Eight in flight keeps the descriptor
 * table and peak plaintext memory bounded while still overlapping enough I/O
 * to stop a cold pass from being a multi-minute wall clock.
 */
const FOLD_CONCURRENCY = 8;

/**
 * Run `worker` over `items` with at most `limit` in flight, preserving nothing
 * about order (callers here fold independent sessions, so order is irrelevant).
 * @param items - work items.
 * @param limit - maximum concurrent workers.
 * @param worker - one item to process.
 */
async function runPooled(items, limit, worker) {
	let next = 0;
	const size = Math.max(1, Math.min(limit, items.length));
	const runners = [];
	for (let slot = 0; slot < size; slot += 1) {
		runners.push((async () => {
			for (;;) {
				const index = next;
				next += 1;
				if (index >= items.length) return;
				await worker(items[index]);
			}
		})());
	}
	await Promise.all(runners);
}

/**
 * Fold one persisted session's new events onto its stored state.
 *
 * The returned state is the same object as `previous` when one was supplied,
 * so a failed caller leaves the cached fold untouched.
 *
 * @param persistence - the `sessionPersistence` service.
 * @param id - stored session id.
 * @param revision - opaque revision reported for this session, when known.
 * @param previous - the existing fold state, or undefined for a new session.
 * @returns the fold state to store.
 */
async function foldPersistedSession(persistence, id, revision, previous) {
	const state = previous ?? createUsageState();
	const wasPersisted = state.kind === "persisted";
	const fromSeq = wasPersisted ? state.consumed ?? 0 : 0;
	const events = await readPersistedEvents(persistence, id, fromSeq);
	if (!wasPersisted) {
		state.days = new Map();
		state.openSteps = new Map();
		state.lastSample = null;
		state.currentModel = null;
		state.consumed = 0;
		state.title = null;
	}
	const fresh = wasPersisted ? events.filter((event) => event.seq > (state.consumed ?? 0)) : events;
	if (fresh.length === 0) {
		// 没有新事件：绝大多数会话每轮聚合都落在这里。空 delta 不携带
		// 「日志被截断」的信息——过去把它算成不连续，于是每个安静
		// 会话每轮都从头重读自己的完整日志（上千会话时是分钟级的
		// 墙钟，而数据一个字节都不会变）。折叠态保持不动。
	} else if (state.consumed > 0 && fresh[0].seq !== state.consumed + 1) {
		// 确实有新事件却接不上：日志被截断/重写，从头重折。
		state.days = new Map();
		state.openSteps = new Map();
		state.lastSample = null;
		state.currentModel = null;
		state.consumed = 0;
		state.title = null;
		const allEvents = await readPersistedEvents(persistence, id, 0);
		applyUsageDelta(state, allEvents);
		state.consumed = allEvents.length > 0 ? allEvents[allEvents.length - 1].seq : 0;
	} else {
		applyUsageDelta(state, fresh);
		state.consumed = fresh[fresh.length - 1].seq;
	}
	state.kind = "persisted";
	if (revision !== void 0) state.revision = revision;
	return state;
}

/**
 * Render whatever the persisted fold state already holds, without touching a
 * single session log.
 *
 * `usage-stats-cache.json` is a complete answer to "what did I spend" as of
 * the last run — it is exactly the input {@link collectUsageLocked} feeds into
 * `renderUsage`. Serving it before the corpus has been re-scanned is what
 * makes the panel open instantly: the first request after a process start
 * otherwise queues behind a full re-fold, which walks 1400+ session logs and
 * costs tens of seconds on this corpus.
 *
 * The snapshot is marked `stale` so the client can keep it on screen and
 * refresh itself once the real re-fold lands, instead of showing it as
 * authoritative.
 *
 * @param cache - the loaded fold cache.
 * @returns the wire shape, flagged stale.
 */
function renderCachedSnapshot(cache) {
	const byDay = new Map();
	for (const state of Object.values(cache.sessions)) mergeInto(byDay, state.days);
	return { ...renderUsage(byDay, null, Date.now()), stale: true };
}

/**
 * Compare whether two revisions correspond to the same physical file state.
 * DSH appends a corpus-wide hash (`:hash`) to historical format revisions (v3/v2/v1),
 * which changes whenever ANY session in the workspace is touched or created.
 * For usage statistics, if the underlying file's dev:ino:size:mtime:ctime is unchanged,
 * its content and tokens are guaranteed to be unchanged.
 */
function sameFileRevision(a, b) {
	if (a === b) return true;
	if (typeof a !== "string" || typeof b !== "string") return false;
	const aParts = a.split(":");
	const bParts = b.split(":");
	if (aParts.length >= 5 && bParts.length >= 5) {
		return aParts[0] === bParts[0] &&
		       aParts[1] === bParts[1] &&
		       aParts[2] === bParts[2] &&
		       aParts[3] === bParts[3] &&
		       aParts[4] === bParts[4];
	}
	return false;
}

/**
 * Collect per-day usage across live and persisted sessions, incrementally.
 *
 * Live sessions: fold only the in-memory events added since the last fold.
 * Persisted sessions: skipped when the backend's opaque revision is
 * unchanged (DSH 0.1.5 `sessionPersistence.list()` snapshots carry
 * `{ header, revision }`; older hosts exposed `listSnapshots()`, falling
 * back to always reading the delta); when the revision changes, the new
 * events are verified to be contiguous with the last folded seq — a gap or
 * an empty delta means the log was truncated/rewritten, so the session is
 * refolded from scratch. Sessions that vanished are dropped, and a session
 * switching between live/persisted is refolded from scratch to stay exact.
 * A failed per-session read keeps the previous fold — it must never erase
 * history from the cache.
 */
export async function collectUsage(ctx, force = false) {
	if (!force && cachedUsageResult !== null && Date.now() - lastCollectTime < USAGE_COLLECT_TTL_MS) {
		return cachedUsageResult;
	}
	// 冷启动：进程刚起来时 cachedUsageResult 还没有值。此处先花几毫秒把磁盘上
	// 已有的折叠态渲染成快照（不碰任何会话日志），让第一个请求直接拿到数据，
	// 而不是排在语料重扫后面干等几十秒。
	if (!force && cachedUsageResult === null) {
		await warmSnapshot();
	}
	// 已经有旧快照时，调用方绝不排队等重算：先把旧值给出去，刷新丢后台。
	// 聚合要遍历全部会话日志（上千会话时是分钟级），挂在请求路径上等于面板
	// 「点了跟没点一样」。force（refresh=1）仍然同步等——那是用户主动要新数据。
	if (!force && cachedUsageResult !== null) {
		void withLock(() => collectUsageLocked(ctx)).catch((error) => {
			ctx.logger.warn(`usage-stats: background usage collect failed: ${String(error)}`);
		});
		return cachedUsageResult;
	}
	return withLock(() => collectUsageLocked(ctx));
}

/**
 * The aggregation itself. Always runs under {@link withLock}; callers must not
 * invoke it directly. Re-checks the TTL so that a request queued behind an
 * in-flight run returns that run's fresh result instead of recomputing.
 */
async function collectUsageLocked(ctx) {
	if (cachedUsageResult !== null && Date.now() - lastCollectTime < USAGE_COLLECT_TTL_MS) {
		return cachedUsageResult;
	}
	const cache = await loadCache();
	const live = ctx.get("sessions");
	const attached = new Set();
	if (live !== void 0) {
		for (const session of live.list()) {
			attached.add(session.id);
			const state = cache.sessions[session.id] ?? createUsageState();
			if (state.kind !== "live") {
				// Live/persisted transition: refold the whole in-memory log.
				state.days = new Map();
				state.openSteps = new Map();
				state.lastSample = null;
				state.currentModel = null;
				state.consumed = 0;
			}
			// DSH 0.1.2-alpha.4 removed the public `Session#events` accessor
			// (only snapshotEvents() remains). Read whichever the host
			// exposes so the live fold works on older and current hosts.
			const events = session.events !== void 0 ? session.events
				: typeof session.snapshotEvents === "function" ? session.snapshotEvents()
				: [];
			const count = events.length;
			if ((state.consumed ?? 0) < count) {
				applyUsageDelta(state, events.slice(state.consumed ?? 0));
				state.consumed = count;
			}
			state.kind = "live";
			cache.sessions[session.id] = state;
		}
	}
	const persistence = ctx.get("sessionPersistence");
	const persistedIds = new Set();
	if (persistence !== void 0) {
		// Prefer the backend's opaque per-log revisions (no file I/O in the
		// plugin, works for any backend that exposes listSnapshots).
		let snapshots = null;
		if (typeof persistence.listSnapshots === "function") {
			try {
				snapshots = await persistence.listSnapshots();
			} catch (error) {
				ctx.logger.warn(`usage-stats: listSnapshots failed, falling back to list(): ${String(error)}`);
			}
		}
		// DSH 0.1.5 `list()` returns `{ header, revision, sizeBytes }`
		// snapshots while older hosts returned bare headers; normalize both.
		const listed = snapshots !== null ? snapshots : await persistence.list();
		const entries = [];
		for (const item of listed ?? []) {
			if (item === null || typeof item !== "object") continue;
			const header = item.header !== void 0 ? item.header : item;
			const id = header?.id;
			if (typeof id !== "string" || id.length === 0) continue;
			entries.push({ id, revision: item.revision });
		}
		for (const { id, revision } of entries) persistedIds.add(id);
		// Sessions whose opaque revision is unchanged keep their folded state
		// untouched — that is the steady state, and it costs no I/O at all.
		const stale = [];
		for (const { id, revision } of entries) {
			if (attached.has(id)) continue;
			const previous = cache.sessions[id];
			if (previous !== void 0 && previous.kind === "persisted" && revision !== void 0 && sameFileRevision(previous.revision, revision)) {
				if (previous.revision !== revision) previous.revision = revision;
				continue;
			}
			stale.push({ id, revision, previous });
		}
		// Fold concurrently. Each worker reads one log and writes only
		// `cache.sessions[id]`, so sessions stay independent and the merged
		// result is order-insensitive (all arithmetic is integral). The serial
		// form made a cold or invalidated pass a 5–20 minute wall clock over
		// this corpus, and the panel is unusable for every one of those
		// minutes. Concurrency is capped: each open log can expand to tens of
		// megabytes of plaintext, and 1250 simultaneous opens would exhaust
		// the descriptor table long before it finished faster.
		await runPooled(stale, FOLD_CONCURRENCY, async ({ id, revision, previous }) => {
			try {
				cache.sessions[id] = await foldPersistedSession(persistence, id, revision, previous);
			} catch (error) {
				// A failed per-session read keeps the previous fold — it must
				// never erase history from the cache.
				ctx.logger.warn(`usage-stats: reading persisted session "${id}" failed: ${String(error)}`);
			}
		});
	}
	for (const id of Object.keys(cache.sessions)) {
		if (!attached.has(id) && !persistedIds.has(id)) delete cache.sessions[id];
	}
	const byDay = new Map();
	for (const state of Object.values(cache.sessions)) mergeInto(byDay, state.days);
	const rendered = renderUsage(byDay, null, Date.now());
	cachedUsageResult = rendered;
	lastCollectTime = Date.now();
	// Keep the atomic cache write inside the single-flight section: two passes
	// racing on the same temp file is the one failure mode that would corrupt
	// the file. It stays on the request path deliberately — with the hourly and
	// interval folds gone the cache is a few hundred KB, so this costs single-
	// digit milliseconds and buys crash-safety for every counted token.
	await saveCache(ctx, cache);
	return rendered;
}

async function handleUsage(ctx, req, res) {
	if (rejectForeignCaller(req, res)) return;
	try {
		const force = typeof req.url === "string" && (req.url.includes("refresh=1") || req.url.includes("force=1"));
		const result = await collectUsage(ctx, force);
		json(res, 200, { ok: true, ...result });
	} catch (error) {
		ctx.logger.warn(`usage-stats: usage aggregation failed: ${String(error)}`);
		json(res, 500, { ok: false, error: "internal", message: error instanceof Error ? error.message : String(error) });
	}
}

//#region signal / day sessions / budget

/** Local budget file (30-day token budget the user set in the panel). */
function budgetPath() {
	const home = process.env.DSH_HOME ?? join(homedir(), ".dsh");
	return join(home, "storages", "usage-budget.json");
}

/** Read the persisted token budget; null when unset or unreadable. */
async function readBudget() {
	try {
		const raw = JSON.parse(await readFile(budgetPath(), "utf8"));
		if (raw !== null && typeof raw === "object" && Number.isFinite(raw.budget) && raw.budget >= 0) return raw.budget;
	} catch {
		/* first run or corrupt file */
	}
	return null;
}

/** Persist the token budget atomically; failures are logged, never fatal. */
async function writeBudget(ctx, budget) {
	try {
		const path = budgetPath();
		await mkdir(dirname(path), { recursive: true });
		const tmp = `${path}.tmp`;
		await writeFile(tmp, JSON.stringify({ version: 1, budget, updatedAt: Date.now() }), "utf8");
		await rename(tmp, path);
		return true;
	} catch (error) {
		ctx.logger.warn(`usage-stats: saving budget failed: ${String(error)}`);
		return false;
	}
}

/**
 * GET /api/usage-stats/signal — agent efficiency attribution plus forward
 * usage signals over a trailing natural-day window (`?days=`, default 30),
 * together with the locally stored token budget.
 */
async function handleSignal(ctx, req, res) {
	if (rejectForeignCaller(req, res)) return;
	try {
		const url = new URL(req.url ?? "/", "http://x");
		const days = Math.max(7, Math.min(90, Number.parseInt(url.searchParams.get("days") ?? "30", 10) || 30));
		const result = await collectUsage(ctx);
		const [signal, budget] = [renderSignal(result.days, Date.now(), { windowDays: days }), await readBudget()];
		json(res, 200, { ok: true, ...signal, budget });
	} catch (error) {
		ctx.logger.warn(`usage-stats: signal aggregation failed: ${String(error)}`);
		json(res, 500, { ok: false, error: "internal", message: error instanceof Error ? error.message : String(error) });
	}
}

/**
 * GET /api/usage-stats/day-sessions?date=YYYY-MM-DD — the sessions that saw
 * usage on one local-calendar day, descending by tokens. Titles come from the
 * folded `session/title` events. `firstAt`/`lastAt` are always null: they used
 * to come from that day's step intervals, which are no longer retained.
 */
async function handleDaySessions(ctx, req, res) {
	if (rejectForeignCaller(req, res)) return;
	try {
		const url = new URL(req.url ?? "/", "http://x");
		const date = url.searchParams.get("date") ?? "";
		if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
			json(res, 400, { ok: false, error: "invalid-date", message: "date must be YYYY-MM-DD" });
			return;
		}
		await collectUsage(ctx);
		const rows = await withLock(async () => {
			const cache = await loadCache();
			const sessions = [];
			for (const [id, state] of Object.entries(cache.sessions)) {
				const entry = state.days.get(date);
				if (entry === void 0) continue;
				const tokens = totalTokens(entry.totals);
				if (!(tokens > 0)) continue;
				sessions.push({
					id,
					title: typeof state.title === "string" && state.title.length > 0 ? state.title : null,
					tokens,
					requests: entry.requests ?? 0,
					firstAt: null,
					lastAt: null
				});
			}
			sessions.sort((a, b) => b.tokens - a.tokens);
			return sessions;
		});
		json(res, 200, { ok: true, date, sessions: rows });
	} catch (error) {
		ctx.logger.warn(`usage-stats: day-sessions failed: ${String(error)}`);
		json(res, 500, { ok: false, error: "internal", message: error instanceof Error ? error.message : String(error) });
	}
}

/** GET /api/usage-stats/budget — the locally stored 30-day token budget. */
async function handleBudgetGet(ctx, req, res) {
	if (rejectForeignCaller(req, res)) return;
	json(res, 200, { ok: true, budget: await readBudget() });
}

/** POST /api/usage-stats/budget — persist the token budget (0 clears it). */
async function handleBudgetPost(ctx, req, res) {
	if (rejectForeignWrite(req, res)) return;
	try {
		const body = await readJsonBody(req);
		const value = body?.budget;
		if (value === void 0 || value === null || value === "") {
			json(res, 400, { ok: false, error: "invalid-budget", message: "budget must be a non-negative number" });
			return;
		}
		const budget = typeof value === "number" ? value : Number(String(value).trim().replace(/,/g, ""));
		if (!Number.isFinite(budget) || budget < 0) {
			json(res, 400, { ok: false, error: "invalid-budget", message: "budget must be a non-negative number" });
			return;
		}
		if (!await writeBudget(ctx, budget)) {
			json(res, 500, { ok: false, error: "internal", message: "saving the budget failed" });
			return;
		}
		json(res, 200, { ok: true, budget });
	} catch (error) {
		ctx.logger.warn(`usage-stats: budget write failed: ${String(error)}`);
		json(res, 500, { ok: false, error: "internal", message: error instanceof Error ? error.message : String(error) });
	}
}

//#endregion signal / day sessions / budget

/**
 * Enumerate the harness's configured providers: the official DeepSeek route
 * (`llm-deepseek` settings namespace) plus every pi-ai provider profile
 * (`llm-pi-ai` settings namespace). Each entry carries the connection facts
 * (credential ref + base URL) needed to query a balance — no keys here.
 */
async function configuredProviders(ctx) {
	const settings = ctx.get("settings");
	const getSetting = (ns) => typeof settings?.get === "function"
		? settings.get(ns)
		: settings?.describe?.()?.find((d) => d.ns === ns)?.value;
	const providers = [];
	const deepseek = getSetting("llm-deepseek");
	if (deepseek !== void 0 && deepseek !== null && typeof deepseek === "object") {
		providers.push({
			id: "deepseek-official",
			displayName: "DeepSeek",
			apiKeyEnv: typeof deepseek.apiKeyEnv === "string" ? deepseek.apiKeyEnv : DEEPSEEK_DEFAULTS.apiKeyEnv,
			baseURL: typeof deepseek.baseURL === "string" ? deepseek.baseURL : DEEPSEEK_DEFAULTS.baseURL
		});
	} else {
		providers.push({
			id: "deepseek-official",
			displayName: "DeepSeek",
			apiKeyEnv: DEEPSEEK_DEFAULTS.apiKeyEnv,
			baseURL: DEEPSEEK_DEFAULTS.baseURL
		});
	}
	const pi = getSetting("llm-pi-ai");
	if (pi !== void 0 && pi !== null && typeof pi === "object" && pi.providers !== void 0 && typeof pi.providers === "object") {
		for (const [route, profile] of Object.entries(pi.providers)) {
			if (profile === null || typeof profile !== "object") continue;
			providers.push({
				id: route,
				displayName: typeof profile.displayName === "string" && profile.displayName.length > 0 ? profile.displayName : route,
				apiKeyEnv: typeof profile.apiKeyEnv === "string" ? profile.apiKeyEnv : void 0,
				baseURL: typeof profile.baseURL === "string" ? profile.baseURL : void 0
			});
		}
	}
	return providers;
}

async function handleProviders(ctx, accounts, req, res) {
	if (rejectForeignCaller(req, res)) return;
	try {
		json(res, 200, { ok: true, providers: await accounts.providerViews() });
	} catch (error) {
		ctx.logger.warn(`usage-stats: providers enumeration failed: ${String(error)}`);
		json(res, 500, { ok: false, error: "internal", message: error instanceof Error ? error.message : String(error) });
	}
}

async function selectedProviderId(req, accounts) {
	const url = new URL(req.url ?? "/", "http://x");
	const requested = url.searchParams.get("provider");
	if (requested !== null && requested !== "") return requested;
	const providers = await accounts.providerViews();
	return providers.find((entry) => entry.id === "deepseek-official")?.id
		?? providers.find((entry) => entry.configured)?.id
		?? providers[0]?.id
		?? null;
}

/** Unified account endpoint; cached by default, `refresh=1` forces upstream. */
async function handleAccount(ctx, accounts, req, res) {
	if (rejectForeignCaller(req, res)) return;
	try {
		const url = new URL(req.url ?? "/", "http://x");
		const providerId = await selectedProviderId(req, accounts);
		const account = providerId === null ? null : await accounts.get(providerId, { force: url.searchParams.get("refresh") === "1" });
		if (account === null) {
			json(res, 200, { ok: false, error: "unknown-provider", message: `provider "${providerId}" is not configured` });
			return;
		}
		json(res, 200, { ok: true, account });
	} catch (error) {
		ctx.logger.warn(`usage-stats: account fetch failed: ${String(error)}`);
		json(res, 500, { ok: false, error: "internal", message: error instanceof Error ? error.message : String(error) });
	}
}

/** Write one allow-listed credential reference through the credentials seam. */
async function handleCredentials(ctx, accounts, req, res) {
	if (rejectForeignWrite(req, res)) return;
	if (req.method !== "POST") {
		res.writeHead(405, { "content-type": "application/json; charset=utf-8" });
		res.end(JSON.stringify({ ok: false, error: "method-not-allowed" }));
		return;
	}
	try {
		const body = await readJsonBody(req);
		const ref = typeof body?.ref === "string" ? body.ref.trim() : "";
		const value = typeof body?.value === "string" ? body.value : "";
		if (!WRITABLE_CREDENTIAL_REFS.has(ref)) {
			json(res, 400, { ok: false, error: "invalid-ref", message: `credential "${ref}" is not writable from the panel` });
			return;
		}
		if (value === "") {
			json(res, 400, { ok: false, error: "empty-value", message: "credential value must not be empty" });
			return;
		}
		const credentials = ctx.get("credentials") ?? ctx.credentials;
		if (credentials === null || credentials === void 0 || typeof credentials.set !== "function") {
			json(res, 500, { ok: false, error: "read-only", message: "credential store is read-only" });
			return;
		}
		await credentials.set(ref, value);
		json(res, 200, { ok: true, ref });
	} catch (error) {
		ctx.logger.warn(`usage-stats: credential write failed: ${String(error)}`);
		json(res, 500, { ok: false, error: "internal", message: error instanceof Error ? error.message : String(error) });
	}
}

/** Backward-compatible balance route delegated to the account registry. */
async function handleBalance(ctx, accounts, req, res) {
	if (rejectForeignCaller(req, res)) return;
	try {
		const providerId = await selectedProviderId(req, accounts);
		const account = providerId === null ? null : await accounts.get(providerId);
		if (account === null) {
			json(res, 200, { ok: false, error: "unknown-provider", message: `provider "${providerId}" is not configured` });
			return;
		}
		if (account.mode !== "balance" || account.status === "unsupported") {
			json(res, 200, {
				ok: false,
				error: "unsupported",
				message: `${account.displayName} has no public balance interface`,
				provider: account.id
			});
			return;
		}
		if (account.status === "not-configured") {
			json(res, 200, {
				ok: false,
				error: "no-credential",
				message: account.missingCredentials?.[0] ?? "api key",
				provider: account.id
			});
			return;
		}
		if (account.balance === null || account.balance === void 0) {
			json(res, 502, { ok: false, error: "failed", message: account.status });
			return;
		}
		json(res, 200, {
			ok: true,
			provider: account.id,
			balance: {
				isAvailable: account.status === "ok" || account.stale === true,
				currency: account.balance.currency,
				total: account.balance.remaining,
				granted: account.balance.breakdown?.granted,
				toppedUp: account.balance.breakdown?.toppedUp
			},
			fetchedAt: account.fetchedAt
		});
	} catch (error) {
		ctx.logger.warn(`usage-stats: balance fetch failed: ${String(error)}`);
		json(res, 502, { ok: false, error: "failed", message: error instanceof Error ? error.message : String(error) });
	}
}

/** Query normalized percentage windows for subscription-style providers. */
async function handleSubscriptions(ctx, accounts, req, res) {
	if (rejectForeignCaller(req, res)) return;
	try {
		const subscriptions = (await accounts.subscriptionAccounts()).filter(Boolean).map((account) => (
			account.adapter === "zai-token-plan" ? { ...account, id: "zai" } : account
		));
		json(res, 200, { ok: true, subscriptions, fetchedAt: Date.now() });
	} catch (error) {
		ctx.logger.warn(`usage-stats: subscription usage failed: ${String(error)}`);
		json(res, 500, { ok: false, error: "internal", message: error instanceof Error ? error.message : String(error) });
	}
}

/** DeepSeek platform monthly billing export (cost + per-model usage detail). */
async function handleBilling(ctx, req, res) {
	if (rejectForeignCaller(req, res)) return;
	try {
		const rawMonths = new URL(req.url ?? "/", "http://x").searchParams.get("months");
		const months = Math.max(1, Math.min(12, Number.parseInt(rawMonths ?? "3", 10) || 3));
		json(res, 200, {
			ok: true,
			...await queryDeepseekBilling(ctx.get("credentials") ?? ctx.credentials, { months })
		});
	} catch (error) {
		ctx.logger.warn(`usage-stats: deepseek billing failed: ${String(error)}`);
		json(res, 500, {
			ok: false,
			error: "internal",
			message: error instanceof Error ? error.message : String(error)
		});
	}
}

/** Start an immediate refresh and repeat account + local usage refresh every 5 minutes. */
export function startBackgroundRefresh(ctx, accounts, deps = {}) {
	let running = false;
	let stopped = false;
	let active = Promise.resolve();
	const run = async () => {
		if (running || stopped) return;
		running = true;
		active = (async () => {
			const results = await Promise.allSettled([accounts.refreshAll(), collectUsage(ctx)]);
			for (const result of results) if (result.status === "rejected") ctx.logger.warn(`usage-stats: background refresh failed: ${String(result.reason)}`);
		})().finally(() => {
			running = false;
		});
		return active;
	};
	void run();
	const setTimer = deps.setInterval ?? setInterval;
	const clearTimer = deps.clearInterval ?? clearInterval;
	const timer = setTimer(run, deps.intervalMs ?? ACCOUNT_REFRESH_MS);
	timer?.unref?.();
	const stop = async () => {
		stopped = true;
		clearTimer(timer);
		await active;
	};
	stop.refreshNow = async () => {
		await active;
		return run();
	};
	return stop;
}

/** Floor/ceiling for the self-paced usage aggregation loop. */
const USAGE_REFRESH_MIN_MS = 30_000;
const USAGE_REFRESH_MAX_MS = 300_000;

/**
 * Keep the usage snapshot warm so the panel never waits on an aggregation.
 *
 * Why its own loop instead of riding the account refresh: usage aggregation
 * walks every persisted session log, so its cost is a property of the corpus
 * (thousands of sessions ⇒ tens of seconds), not of the provider APIs. A fixed
 * cadence either hammers a big corpus or leaves a long stale window, and any
 * window the user happens to open the panel in is a minute of "nothing
 * happened". So: warm once at startup, then self-schedule at
 * `clamp(2 × last run, 30s, 5min)` — cheap corpora stay fresh, expensive ones
 * back off instead of queueing behind themselves.
 *
 * @param ctx - plugin context carrying the session services.
 * @param deps - `setTimeout`/`clearTimeout` overrides and `minMs`/`maxMs` for tests.
 * @returns disposer that stops the loop after the in-flight run settles.
 */
export function startUsageRefresh(ctx, deps = {}) {
	let stopped = false;
	let timer = null;
	let active = Promise.resolve();
	let lastDurationMs = 0;
	const setTimer = deps.setTimeout ?? setTimeout;
	const clearTimer = deps.clearTimeout ?? clearTimeout;
	const minMs = deps.minMs ?? USAGE_REFRESH_MIN_MS;
	const maxMs = deps.maxMs ?? USAGE_REFRESH_MAX_MS;
	const schedule = () => {
		if (stopped) return;
		const delay = Math.min(maxMs, Math.max(minMs, lastDurationMs * 2));
		timer = setTimer(() => { void run(); }, delay);
		timer?.unref?.();
	};
	const run = async () => {
		if (stopped) return;
		const startedAt = Date.now();
		active = collectUsage(ctx).catch((error) => {
			ctx.logger.warn(`usage-stats: usage refresh failed: ${String(error)}`);
		}).finally(() => {
			lastDurationMs = Date.now() - startedAt;
			schedule();
		});
		return active;
	};
	void run();
	const stop = async () => {
		stopped = true;
		if (timer !== null) clearTimer(timer);
		await active;
	};
	stop.refreshNow = async () => {
		await active;
		return run();
	};
	return stop;
}

/**
 * Plugin body: register the five exact routes and start background refresh.
 * @param ctx - plugin context carrying webServer, credentials, sessions, sessionPersistence, settings, and llm.
 */
const Config = {
	"~standard": {
		version: 1,
		vendor: "dsh-usage-skill",
		validate(value) {
			try {
				return { value: validateAccountConfig(value ?? {}) };
			} catch (error) {
				return { issues: [{ message: error instanceof Error ? error.message : String(error) }] };
			}
		}
	}
};

async function apply(ctx, rawConfig = {}, deps = {}) {
	const config = validateAccountConfig(rawConfig);
	const accounts = deps.accounts ?? createAccountService({
		credentials: ctx.get("credentials") ?? ctx.credentials,
		getProviders: () => configuredProviders(ctx),
		config,
		deps: { timeoutMs: UPSTREAM_TIMEOUT_MS }
	});
	// Provider ids come from the async Harness settings service, so this dynamic
	// part of config validation must finish before any routes or timers start.
	await accounts.validate();
	ctx.effect(() => ctx.webServer.register({
		kind: "exact",
		path: USAGE_PATH,
		handler: (req, res) => handleUsage(ctx, req, res)
	}), "usage-stats: usage route");
	ctx.effect(() => ctx.webServer.register({
		kind: "exact",
		path: SIGNAL_PATH,
		handler: (req, res) => handleSignal(ctx, req, res)
	}), "usage-stats: signal route");
	ctx.effect(() => ctx.webServer.register({
		kind: "exact",
		path: DAY_SESSIONS_PATH,
		handler: (req, res) => handleDaySessions(ctx, req, res)
	}), "usage-stats: day-sessions route");
	ctx.effect(() => ctx.webServer.register({
		kind: "exact",
		path: BUDGET_PATH,
		handler: (req, res) => {
			if (req.method === "POST") return handleBudgetPost(ctx, req, res);
			return handleBudgetGet(ctx, req, res);
		}
	}), "usage-stats: budget route");
	ctx.effect(() => ctx.webServer.register({
		kind: "exact",
		path: PROVIDERS_PATH,
		handler: (req, res) => handleProviders(ctx, accounts, req, res)
	}), "usage-stats: providers route");
	ctx.effect(() => ctx.webServer.register({
		kind: "exact",
		path: ACCOUNT_PATH,
		handler: (req, res) => handleAccount(ctx, accounts, req, res)
	}), "usage-stats: account route");
	ctx.effect(() => ctx.webServer.register({
		kind: "exact",
		path: CREDENTIALS_PATH,
		handler: (req, res) => handleCredentials(ctx, accounts, req, res)
	}), "usage-stats: credentials route");
	ctx.effect(() => ctx.webServer.register({
		kind: "exact",
		path: BALANCE_PATH,
		handler: (req, res) => handleBalance(ctx, accounts, req, res)
	}), "usage-stats: balance route");
	ctx.effect(() => ctx.webServer.register({
		kind: "exact",
		path: SUBSCRIPTIONS_PATH,
		handler: (req, res) => handleSubscriptions(ctx, accounts, req, res)
	}), "usage-stats: subscriptions route");
	ctx.effect(() => ctx.webServer.register({
		kind: "exact",
		path: BILLING_PATH,
		handler: (req, res) => handleBilling(ctx, req, res)
	}), "usage-stats: deepseek-billing route");
	if (deps.disableBackgroundRefresh !== true) {
		ctx.effect(() => startBackgroundRefresh(ctx, accounts), "usage-stats: background account refresh");
		ctx.effect(() => startUsageRefresh(ctx), "usage-stats: background usage aggregation");
	}
	// Skill management (merged from dsh-skill-manager): bundle grouping, upload, loose skills.
	// dsh-triad patch: `deps.disableSkills` lets the aggregator mount usage without skills.
	if (deps.disableSkills !== true) await applySkills(ctx);
}

export { apply, Config, inject, name, USAGE_PATH, SIGNAL_PATH, DAY_SESSIONS_PATH, BUDGET_PATH, PROVIDERS_PATH, BALANCE_PATH, SUBSCRIPTIONS_PATH, ACCOUNT_PATH, CREDENTIALS_PATH, BILLING_PATH, configuredProviders, totalTokens, zeroBuckets };


