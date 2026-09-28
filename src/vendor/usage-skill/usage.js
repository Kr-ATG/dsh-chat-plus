/**
 * dsh-usage-skill — pure per-day, per-model token-usage aggregation over
 * session event logs. Kept free of cordis imports so it can be unit-tested
 * and validated against real logs outside the running harness.
 *
 * Aggregation semantics mirror `dsh-token-meter`'s `tokenUsage` projection:
 * a usage sample rides an `assistant/chunk` (`data.chunk.type === "usage"`)
 * or an `assistant/message` (`data.usage`); a repeated sample for the same
 * (turn, step) REPLACES the earlier value instead of double counting it, and
 * the replacement is re-attributed to the day of the later event.
 *
 * Each sample is additionally attributed to the model that produced it:
 * `assistant/message` carries `data.message.source.model`; usage chunks fall
 * back to the last `request/header` `data.header.config.model`; samples with
 * no model information land in the `unknown` bucket.
 *
 * @module dsh-usage-skill/usage
 */

/** Local-calendar `YYYY-MM-DD` key for a millisecond epoch. */
export function dayKey(timeMs) {
	const date = new Date(timeMs);
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${date.getFullYear()}-${month}-${day}`;
}

/** Local-calendar `YYYY-MM-DD-HH` key for a millisecond epoch (hour granularity). */
export function hourKey(timeMs) {
	const date = new Date(timeMs);
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	const hour = String(date.getHours()).padStart(2, "0");
	return `${date.getFullYear()}-${month}-${day}-${hour}`;
}

/** Empty token bucket. */
export function zeroBuckets() {
	return {
		inputTokens: 0,
		outputTokens: 0,
		cacheReadTokens: 0,
		cacheWriteTokens: 0
	};
}

/** Provider usage → buckets (missing cache fields are absent in some reports). */
export function bucketsOf(usage) {
	return {
		inputTokens: usage.inputTokens ?? 0,
		outputTokens: usage.outputTokens ?? 0,
		cacheReadTokens: usage.cacheReadTokens ?? 0,
		cacheWriteTokens: usage.cacheWriteTokens ?? 0
	};
}

/** Total tokens across all buckets. */
export function totalTokens(buckets) {
	return buckets.inputTokens + buckets.outputTokens + buckets.cacheReadTokens + buckets.cacheWriteTokens;
}

/**
 * Prompt-side cache hit rate in percent (0–100, one decimal), or null when
 * no prompt tokens were reported at all. Hits over the whole prompt side:
 * cacheRead / (input + cacheRead + cacheWrite).
 */
export function cacheHitRate(buckets) {
	const input = buckets.inputTokens ?? 0;
	const cacheRead = buckets.cacheReadTokens ?? 0;
	const cacheWrite = buckets.cacheWriteTokens ?? 0;
	const promptTokens = input + cacheRead + cacheWrite;
	if (promptTokens <= 0) return null;
	return Math.round((cacheRead / promptTokens) * 1000) / 10;
}

function addInto(target, source) {
	target.inputTokens += source.inputTokens;
	target.outputTokens += source.outputTokens;
	target.cacheReadTokens += source.cacheReadTokens;
	target.cacheWriteTokens += source.cacheWriteTokens;
	return target;
}

function subtractFrom(target, source) {
	target.inputTokens -= source.inputTokens;
	target.outputTokens -= source.outputTokens;
	target.cacheReadTokens -= source.cacheReadTokens;
	target.cacheWriteTokens -= source.cacheWriteTokens;
	return target;
}

/** Extract the usage sample an event carries, if any. */
function sampleOf(event) {
	if (event.type === "assistant/chunk" && event.data?.chunk?.type === "usage") {
		return {
			key: `${event.data.turn}:${event.data.step}`,
			usage: event.data.chunk.usage
		};
	}
	if (event.type === "assistant/message" && event.data?.usage !== void 0) {
		return {
			key: `${event.data.turn}:${event.data.step}`,
			usage: event.data.usage
		};
	}
	return void 0;
}

/**
 * The `provider/model` attribution key of a usage sample: the exact provider
 * route (dsh adapter id or pi-ai route) plus the model id, so the SAME model
 * served by different providers stays distinct. `assistant/message` names
 * its provider via `data.message.source`; usage chunks fall back to the last
 * `request/header` `data.header.config`; samples with no model information
 * land in the `unknown/unknown` bucket.
 */
function modelOf(event) {
	const source = event.data?.message?.source;
	if (source !== void 0 && typeof source.model === "string") {
		return `${typeof source.provider === "string" && source.provider.length > 0 ? source.provider : "unknown"}/${source.model}`;
	}
	const config = event.data?.header?.config;
	if (config !== void 0 && typeof config.model === "string") {
		return `${typeof config.provider === "string" && config.provider.length > 0 ? config.provider : "unknown"}/${config.model}`;
	}
	return void 0;
}

/** Day entry: totals plus a per-model bucket map, request count. */
function entryOf(byDay, day) {
	let entry = byDay.get(day);
	if (entry === void 0) {
		entry = {
			totals: zeroBuckets(),
			models: new Map(),
			requests: 0,
			compacted: 0
		};
		byDay.set(day, entry);
	}
	return entry;
}

/** Local-calendar `YYYY-MM-DD` key shifted by `deltaDays` from a day key. */
function shiftDay(day, deltaDays) {
	const parts = day.split("-").map(Number);
	const shifted = new Date(parts[0], (parts[1] ?? 1) - 1, (parts[2] ?? 1) + deltaDays);
	return dayKey(shifted.getTime());
}

/**
 * The `count` natural-day keys ending at `endDay` (inclusive), ascending.
 * Days without usage simply yield zero when looked up.
 */
export function lastNaturalDays(endDay, count) {
	const days = [];
	for (let offset = count - 1; offset >= 0; offset -= 1) days.push(shiftDay(endDay, -offset));
	return days;
}

/**
 * One session's incremental fold state. `days` holds the already-folded
 * per-day entries; `lastSample`/`currentModel` let a later event slice keep
 * the replace-last-sample semantics and model attribution across fold
 * boundaries without replaying the whole log.
 */
export function createUsageState() {
	return {
		days: new Map(),
		hours: new Map(),
		lastSample: null,
		currentModel: null,
		consumed: 0,
		openSteps: new Map(),
		/** Newest `session/title` payload (last-wins); null before any title event. */
		title: null
	};
}

/**
 * Fold a slice of NEW events onto an existing session state (mutating).
 * Replacements for the same (turn, step) subtract the previous sample's
 * buckets from the day/model bucket they were attributed to, so a slice
 * starting mid-step (e.g. a usage chunk at the tail of the previous fold)
 * stays exact.
 * @param state - session fold state (mutated in place).
 * @param events - the new events, in seq order, starting after the last fold.
 */
export function applyUsageDelta(state, events) {
	let last = state.lastSample;
	let currentModel = state.currentModel;
	for (const event of events) {
		if (event.type === "request/header") {
			const model = modelOf(event);
			if (model !== void 0) currentModel = model;
		}
		// 会话标题：last-wins（`session/title` 事件携带 { title, messageSeqs, source }）。
		if (event.type === "session/title") {
			const title = event.data?.title;
			if (typeof title === "string" && title.length > 0) state.title = title;
		}
		// 压缩/剪枝的影子计价：`compaction/summary` 与 `compaction/prune` 携带
		// `shadowedTokenCount`（被替换出表面的 token 估算）。归到事件当天累计，
		// 用于「压缩 Token 占比」——它们不是 provider 用量，不进 token 桶。
		if (event.type === "compaction/summary" || event.type === "compaction/prune") {
			const shadowed = event.data?.shadowedTokenCount;
			if (Number.isFinite(shadowed) && shadowed > 0) entryOf(state.days, dayKey(event.time)).compacted += shadowed;
		}
		// 调用次数：每一条 assistant/message 计一次模型调用（与 usage 无关，
		// 无 token 上报的响应同样计入）。
		if (event.type === "assistant/message") {
			entryOf(state.days, dayKey(event.time)).requests += 1;
		}
		// 工作时长：step/start 与 step/end 配对，跨 fold 边界的未闭合 step
		// 由 state.openSteps 携带。step 区间本身不再留存——它只用来算 workMs，
		// 而 workMs 没有任何消费者；每个 step 留一条 [start,end] 却是持久化
		// 缓存里最大的一块（4.5MB 的主体），并且每轮聚合都要把它们拷进全局
		// 天桶再排序一遍。openSteps 仍要留：它只有未闭合的 step，量级是常数。
		if (event.type === "step/start") {
			state.openSteps.set(`${event.data.turn}:${event.data.step}`, event.time);
		} else if (event.type === "step/end") {
			state.openSteps.delete(`${event.data.turn}:${event.data.step}`);
		}
		const sample = sampleOf(event);
		if (sample === void 0) continue;
		const buckets = bucketsOf(sample.usage);
		const model = modelOf(event) ?? currentModel ?? "unknown/unknown";
		const day = dayKey(event.time);
		const entry = entryOf(state.days, day);
		if (last !== null && last.key === sample.key) {
			// Same turn/step re-reported: replace instead of double counting.
			const previous = state.days.get(last.day);
			if (previous !== void 0) {
				subtractFrom(previous.totals, last.buckets);
				const previousModel = previous.models.get(last.model);
				if (previousModel !== void 0) subtractFrom(previousModel, last.buckets);
			}
		}
		addInto(entry.totals, buckets);
		let modelBucket = entry.models.get(model);
		if (modelBucket === void 0) {
			modelBucket = zeroBuckets();
			entry.models.set(model, modelBucket);
		}
		addInto(modelBucket, buckets);
		last = { key: sample.key, day, hour: hourKey(event.time), model, buckets };
	}
	state.lastSample = last;
	state.currentModel = currentModel;
}

/**
 * Fold one session's events into per-day, per-model token buckets.
 * @param events - session event log in seq order.
 * @returns Map<`YYYY-MM-DD`, { totals, models: Map<model, buckets> }> with
 *   only days that saw usage.
 */
export function foldUsage(events) {
	const state = createUsageState();
	applyUsageDelta(state, events);
	return state.days;
}

/**
 * Merge one session's folded days into a global per-day map.
 * @param byDay - global map to mutate.
 * @param sessionDays - session day map (from foldUsage or a state).
 */
export function mergeInto(byDay, sessionDays) {
	for (const [day, entry] of sessionDays) {
		const target = entryOf(byDay, day);
		addInto(target.totals, entry.totals);
		target.requests += entry.requests ?? 0;
		target.compacted += entry.compacted ?? 0;
		for (const [model, buckets] of entry.models) {
			let modelBucket = target.models.get(model);
			if (modelBucket === void 0) {
				modelBucket = zeroBuckets();
				target.models.set(model, modelBucket);
			}
			addInto(modelBucket, buckets);
		}
	}
}

/**
 * Merge overlapping `[start, end]` intervals (毫秒) and return the total
 * non-overlapping duration — 并行会话的 step 时段重叠时只计一次，使一天的工作
 * 时长不会超过 24 小时。
 *
 * Retained as a utility, no longer on any aggregation path: the per-step
 * interval lists it consumed are gone, so nothing calls it during a pass.
 */
export function mergedDuration(intervals) {
	if (intervals === void 0 || intervals.length === 0) return 0;
	const sorted = intervals.slice().sort((a, b) => a[0] - b[0]);
	let total = 0;
	let curStart = sorted[0][0];
	let curEnd = sorted[0][1];
	for (let i = 1; i < sorted.length; i++) {
		const [s, e] = sorted[i];
		if (s <= curEnd) {
			if (e > curEnd) curEnd = e;
		} else {
			total += curEnd - curStart;
			curStart = s;
			curEnd = e;
		}
	}
	total += curEnd - curStart;
	return Math.max(0, total);
}

/**
 * Merge one session fold into a global per-day map (convenience wrapper).
 * @param byDay - global map to mutate.
 * @param events - session events.
 */
export function consumeEvents(byDay, events) {
	mergeInto(byDay, foldUsage(events));
}

/**
 * Render a global per-day map into the wire shape for the usage endpoint.
 * @param byDay - day → entry map.
 * @param _byHour - retired hourly map; accepted and ignored so existing call
 *   sites keep their shape. Nothing has consumed `hours` since the workbench
 *   was folded into this card, and it was 72% of the response body (every hour
 *   bucket ever recorded, forever) plus a second full-size fold to maintain.
 * @param updatedAt - computation timestamp.
 * @returns `{ days, total, updatedAt }` with `days` sorted ascending; each day
 *   carries `models` (descending by tokens) and a `cacheHitRate` percent.
 */
export function renderUsage(byDay, _byHour, updatedAt) {
	const days = [...byDay.entries()]
		.map(([date, entry]) => {
			const models = [...entry.models.entries()]
				.map(([model, buckets]) => ({
					model,
					...buckets,
					tokens: totalTokens(buckets),
					cacheHitRate: cacheHitRate(buckets)
				}))
				.sort((a, b) => b.tokens - a.tokens);
			return {
				date,
				...entry.totals,
				tokens: totalTokens(entry.totals),
				cacheHitRate: cacheHitRate(entry.totals),
				requests: entry.requests ?? 0,
				compacted: entry.compacted ?? 0,
				models
			};
		})
		.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
	const total = zeroBuckets();
	let totalRequests = 0;
	let totalCompacted = 0;
	for (const [, entry] of byDay) {
		addInto(total, entry.totals);
		totalRequests += entry.requests ?? 0;
		totalCompacted += entry.compacted ?? 0;
	}
	return {
		days,
		total: {
			...total,
			tokens: totalTokens(total),
			cacheHitRate: cacheHitRate(total),
			requests: totalRequests,
			compacted: totalCompacted
		},
		updatedAt
	};
}

/**
 * Render the wire shape for the signal endpoint: agent-efficiency attribution
 * plus forward-looking usage signals over a trailing natural-day window.
 *
 * Pure — no I/O, no clock reads beyond `nowMs`.
 * @param days - the `days` array from {@link renderUsage} (ascending).
 * @param nowMs - computation timestamp (anchors the trailing window).
 * @param options - `windowDays` (default 30), `anomalyThreshold` (default 3:
 *   a day counts as anomalous when its tokens exceed the active-day median by
 *   this factor).
 */
export function renderSignal(days, nowMs, options = {}) {
	const windowDays = Math.max(1, options.windowDays ?? 30);
	const anomalyThreshold = Math.max(1.5, options.anomalyThreshold ?? 3);
	const today = dayKey(nowMs);
	const yesterday = shiftDay(today, -1);
	const window = lastNaturalDays(today, windowDays);
	const week = window.slice(-7);
	const byDate = new Map(days.map((day) => [day.date, day]));

	// ── 效率窗口聚合：请求次数 / token / 缓存命中 / 压缩 / 模型分布 ──
	let requests = 0;
	let tokens = 0;
	let promptTokens = 0;
	let cacheReadTokens = 0;
	let compacted = 0;
	const modelTotals = new Map();
	for (const date of window) {
		const day = byDate.get(date);
		if (day === void 0) continue;
		requests += day.requests ?? 0;
		tokens += day.tokens ?? 0;
		promptTokens += (day.inputTokens ?? 0) + (day.cacheReadTokens ?? 0) + (day.cacheWriteTokens ?? 0);
		cacheReadTokens += day.cacheReadTokens ?? 0;
		compacted += day.compacted ?? 0;
		for (const model of day.models ?? []) {
			if (model === null || typeof model !== "object") continue;
			const current = modelTotals.get(model.model) ?? { model: model.model, tokens: 0 };
			current.tokens += model.tokens ?? 0;
			modelTotals.set(model.model, current);
		}
	}
	const topRoutes = [...modelTotals.values()]
		.sort((a, b) => b.tokens - a.tokens)
		.slice(0, 5)
		.map((entry) => ({ model: entry.model, tokens: entry.tokens, share: tokens > 0 ? entry.tokens / tokens : null }));

	// ── 前瞻信号：7 日日均 → 30 日外推；昨日 vs 活跃日中位数倍数 ──
	let weekSum = 0;
	for (const date of week) weekSum += byDate.get(date)?.tokens ?? 0;
	const dailyAvg7 = weekSum / 7;

	const activeTokens = [];
	for (const date of window) {
		const value = byDate.get(date)?.tokens ?? 0;
		if (value > 0) activeTokens.push(value);
	}
	activeTokens.sort((a, b) => a - b);
	let median = null;
	if (activeTokens.length > 0) {
		const mid = Math.floor(activeTokens.length / 2);
		median = activeTokens.length % 2 === 1
			? activeTokens[mid]
			: (activeTokens[mid - 1] + activeTokens[mid]) / 2;
	}

	const yesterdayTokens = byDate.get(yesterday)?.tokens ?? 0;
	const yesterdayMultiple = median !== null && median > 0 ? yesterdayTokens / median : null;
	const anomalyDays = [];
	if (median !== null && median > 0) {
		for (const date of window) {
			const value = byDate.get(date)?.tokens ?? 0;
			if (value > median * anomalyThreshold) {
				anomalyDays.push({ date, tokens: value, multiple: value / median });
			}
		}
		anomalyDays.sort((a, b) => b.tokens - a.tokens);
	}

	return {
		windowDays,
		generatedAt: nowMs,
		efficiency: {
			requests,
			tokens,
			tokensPerRequest: requests > 0 ? tokens / requests : null,
			cacheHitRate: promptTokens > 0 ? Math.round((cacheReadTokens / promptTokens) * 1000) / 10 : null,
			compactedTokens: compacted,
			compactedShare: tokens + compacted > 0 ? compacted / (tokens + compacted) : null,
			topRoutes,
			topRouteShare: topRoutes.length > 0 ? topRoutes[0].share : null
		},
		signal: {
			dailyAvg7,
			projected30: dailyAvg7 * 30,
			activeMedian: median,
			activeDays: activeTokens.length,
			yesterdayDate: yesterday,
			yesterdayTokens,
			yesterdayMultiple,
			anomalyThreshold,
			anomalyDays
		}
	};
}
