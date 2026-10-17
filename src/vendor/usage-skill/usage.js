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
 * ── 观测扩展（缓存 v8）───────────────────────────────────────────
 * 除 token 桶外，逐日与逐模型还要回答大盘第二排的问题：有多少次调用失败、
 * 重试了几次、重试后成功几次、首字要等多久、出字有多快。这些量全部由事件流
 * 直接计数或计时得出；拿不到计时数据时**宁可留空**也不补 0——0 会被读成
 * 「很快」或「没失败」，而真相是「不知道」。
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

/**
 * 非 token 的计数字段：逐日条目与模型桶共用同一组名字。
 *
 * 共用不是为了省事，而是为了让「重报样本要撤销上一次计数」这条规则只写一遍
 * ——加与减都走 {@link addCounters}/{@link subtractCounters}，两边形状必须一致。
 */
const COUNTER_FIELDS = ["requests", "failed", "retries", "retriedSuccess", "ttftMs", "ttftSteps", "genMs", "genTokens"];

/**
 * 模型桶能有的计数字段。
 *
 * 比 {@link COUNTER_FIELDS} 少两个：retries / retriedSuccess 来自
 * llm/retry-started，那个事件**不带模型归属**（它只知道 turn/step），所以只能
 * 记在日级。模型桶若也挂上这两个字段，响应里会多出两个永远是 0 的键——前端
 * 分不清那是「这个模型没重试」还是「这个口径在模型维度不存在」，宁可不要。
 */
const MODEL_COUNTER_FIELDS = COUNTER_FIELDS.filter((field) => field !== "retries" && field !== "retriedSuccess");

/** 全 0 的计数器初值。 */
function zeroCounters() {
	const counters = {};
	for (const field of COUNTER_FIELDS) counters[field] = 0;
	return counters;
}

/** 读出任一桶上的计数器并补 0（老缓存缺字段时也给出完整形状）。 */
function countersOf(source) {
	const counters = {};
	for (const field of COUNTER_FIELDS) {
		/** @type {number | undefined} */
		const value = source?.[field];
		counters[field] = Number.isFinite(value) ? value : 0;
	}
	return counters;
}

/** 累加计数器（缺字段按 0 处理，因此老缓存与新结构可以混着合并）。 */
function addCounters(target, source) {
	for (const field of COUNTER_FIELDS) {
		const value = source?.[field];
		if (value === void 0) continue;
		target[field] = (target[field] ?? 0) + value;
	}
	return target;
}

/** 反向累加计数器：重报同一样本时把上一次记下的数减掉。 */
function subtractCounters(target, source) {
	for (const field of COUNTER_FIELDS) {
		const value = source?.[field];
		if (value === void 0) continue;
		target[field] = (target[field] ?? 0) - value;
	}
	return target;
}

/** 一个模型桶：token 四桶 + 模型维度成立的计数字段。 */
function zeroModelBucket() {
	const bucket = zeroBuckets();
	for (const field of MODEL_COUNTER_FIELDS) bucket[field] = 0;
	return bucket;
}

/** 模型桶的计数器快照（只挑模型维度成立的字段）。 */
export function modelCountersOf(source) {
	const counters = {};
	for (const field of MODEL_COUNTER_FIELDS) {
		const value = source?.[field];
		counters[field] = Number.isFinite(value) ? value : 0;
	}
	return counters;
}

/** 累加到模型桶（只碰模型维度成立的字段，避免塞进永远为 0 的 retries）。 */
function addModelCounters(target, source) {
	for (const field of MODEL_COUNTER_FIELDS) {
		const value = source?.[field];
		if (value === void 0) continue;
		target[field] = (target[field] ?? 0) + value;
	}
	return target;
}

/** 从模型桶撤销（重报样本时用）。 */
function subtractModelCounters(target, source) {
	for (const field of MODEL_COUNTER_FIELDS) {
		const value = source?.[field];
		if (value === void 0) continue;
		target[field] = (target[field] ?? 0) - value;
	}
	return target;
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

/**
 * 已结束 step 起点最多保留多少条。
 *
 * 唯一用途是让「迟到的重报」还能算出首字延迟。真实重报发生在同一轮相邻几次
 * 结算之间，几十条余量足够；再多也抵不过它给持久化缓存加的字节。
 */
const RETAINED_STEP_STARTS = 64;

/**
 * 计入出速的最短生成时长（毫秒）。
 *
 * tool-call 为主的 step 会在首个片段之后立刻结算：分母只有几十毫秒，分子却是整个
 * outputTokens，除出来的「每秒两万 token」不是速度而是分母塌了。实测确实出现过
 * 20060 token/秒 这种数。100ms 以下测不出吞吐，与其截断速率（那是在编一个数字）
 * 不如整条不计——分子分母都不进账，聚合值才不被污染。
 */
const MIN_GEN_MS = 100;

/**
 * 往有界 FIFO Map 里写一条（Map 保持插入顺序，超限就删最早的）。
 * 用于 recentStepStarts / recentFirstTokens：这两个缓存只服务于「迟到的重报」，
 * 上限压死是它们的体积保证——v7 正是为了这点删掉了全量 step 区间。
 */
function rememberBounded(map, key, value) {
	map.delete(key);
	map.set(key, value);
	while (map.size > RETAINED_STEP_STARTS) {
		const oldest = map.keys().next();
		if (oldest.done === true) break;
		map.delete(oldest.value);
	}
}

/**
 * The last raw chunk of one never-packed type in a durable Assistant
 * settlement, scanning backwards — the same lookup the harness's own
 * `lastAssistantStreamChunk` performs.
 *
 * @param stream - the settlement's compact stream records.
 * @returns the final `usage` chunk, or undefined when the stream carries none.
 */
function lastUsageChunkOf(stream) {
	if (!Array.isArray(stream)) return void 0;
	for (let index = stream.length - 1; index >= 0; index -= 1) {
		const record = stream[index];
		if (record !== null && typeof record === "object" && record.type === "chunk" && record.chunk?.type === "usage") {
			return record.chunk.usage;
		}
	}
	return void 0;
}

/**
 * 一个 delta 记录是否携带模型的首个输出 token（与 harness 的 isTokenDelta 同口径）：
 * 非空文本 / 推理片段，或带名字的 tool-call 片段。block、usage、finish 都不算。
 *
 * @param record - 一条 stream 记录；packed run 的判定放在调用方逐个成员展开后做。
 * @param fragment - packed run 里的单个成员文本（raw chunk 记录传 undefined）。
 */
function isTokenDeltaRecord(record, fragment) {
	if (record.type === "chunk") {
		const chunk = record.chunk;
		if (chunk === null || typeof chunk !== "object") return false;
		if (chunk.type === "text-delta" || chunk.type === "reasoning-delta") return chunk.text !== "";
		if (chunk.type === "tool-call-delta") return chunk.argumentsDelta !== "" || chunk.name !== void 0;
		return false;
	}
	if (record.type === "tool-call-chunks") return (fragment ?? "") !== "" || record.name !== void 0;
	return (fragment ?? "") !== "";
}

/** packed run 的成员时间：time0 + dt 前缀累加（dt[i] 是第 i 与第 i+1 个成员之间的间隔）。 */
function runMemberTime(run, index) {
	let time = run.time0;
	for (let i = 0; i < index; i += 1) time += run.dt[i] ?? 0;
	return time;
}

/**
 * 一次结算里模型吐出第一个 token 的时刻，扫描到首个合格成员即停。
 *
 * 语义与 @deepseek-ai/dsh-llm 的 assistantStreamFirstTokenTime 逐条对齐（含
 * packed run 用 time0 + dt 累加还原）。刻意在本地重写而**不 import** 那个模块：
 * 本文件要能在普通 node 下直接 import 做单测，而 @deepseek-ai/* 在 profile 的
 * node_modules 里解析不到（插件构建期已把它 vendor 化处理）。
 *
 * @param stream - 一次结算携带的紧凑 stream 记录。
 * @returns 首 token 的时间戳；流里没有 token 时为 undefined。
 */
export function firstTokenTime(stream) {
	if (!Array.isArray(stream)) return void 0;
	for (const record of stream) {
		if (record === null || typeof record !== "object") continue;
		if (record.type === "chunk") {
			if (isTokenDeltaRecord(record, void 0)) return record.time;
			continue;
		}
		const fragments = record.type === "tool-call-chunks" ? record.args : record.texts;
		if (!Array.isArray(fragments)) continue;
		for (let index = 0; index < fragments.length; index += 1) {
			if (isTokenDeltaRecord(record, fragments[index])) return runMemberTime(record, index);
		}
	}
	return void 0;
}

/**
 * 独立的流式片段事件类型。真实会话日志里流式数据**不嵌在** assistant/message 的
 * data.stream 里（那个字段只有罕见的 assistant/attempt 才带），而是三条独立事件：
 * reasoning-chunks / text-chunks / tool-call-chunks，各自携带 `data.turn`、`data.step`、
 * `data.index`、`data.dt`、以及该 run 第一片的绝对时间 `data.time0`。
 */
const STREAM_RUN_TYPES = new Set(["reasoning-chunks", "text-chunks", "tool-call-chunks"]);

/**
 * 一条独立流式事件里，模型吐出首个 token 的时刻；整个 run 没有合格片段时为 undefined。
 *
 * 判定口径与 harness 的 isTokenDelta 一致：非空文本 / 推理片段算，tool-call 片段
 * 只要带名字或参数非空也算。`dt[i]` 是第 i 与第 i+1 片之间的间隔，所以首片时刻
 * 就是 time0 本身，后续成员才需要前缀累加。
 *
 * @param event - 一条 reasoning-chunks / text-chunks / tool-call-chunks 事件。
 * @returns 首 token 的绝对时间戳，或 undefined。
 */
export function runEventFirstTokenTime(event) {
	const data = event.data;
	if (data === null || typeof data !== "object") return void 0;
	// time0 在**事件顶层**（与 seq0 并列），不在 data 里——真实日志长这样：
	// { type: "reasoning-chunks", seq0, time0, data: { turn, step, index, dt, texts } }。
	// 同时接受 data.time0 是为了兼容“紧凑记录被内嵌进 stream 数组”的另一种形态，
	// 那里的记录本身就是 time0 所在的层级。
	const time0 = Number.isFinite(event.time0) ? event.time0 : data.time0;
	if (!Number.isFinite(time0)) return void 0;
	const fragments = event.type === "tool-call-chunks" ? data.args : data.texts;
	if (!Array.isArray(fragments)) return void 0;
	// tool-call run 只要带了名字，首个片段即使为空也已经是「模型开始吐东西」的信号
	// ——与官方 isTokenDelta / runFirstTokenTime 的分支完全对齐。
	if (event.type === "tool-call-chunks" && typeof data.name === "string" && data.name.length > 0) return time0;
	let time = time0;
	for (let index = 0; index < fragments.length; index += 1) {
		if (index > 0) time += Number.isFinite(data.dt?.[index - 1]) ? data.dt[index - 1] : 0;
		if (typeof fragments[index] === "string" && fragments[index] !== "") return time;
	}
	return void 0;
}

/**
 * Extract the usage sample one durable Assistant settlement reports, if any.
 *
 * This mirrors the harness's own `tokenUsage` projection exactly, and the
 * agreement is load-bearing: that projection is what the session header and
 * the workspace UI show, so any divergence here reads as a broken counter.
 * Two rules the earlier version of this file got wrong, both of which made
 * totals come out LOW:
 *
 *  - Only settlements count. `assistant/message` (preferring its own `usage`
 *    field) and `assistant/attempt` both qualify; a bare `assistant/chunk`
 *    does not. Chunks are mid-stream state, and a settlement re-reports the
 *    same sample the last chunk already carried — folding them independently
 *    double-counts an attempt that never settled and mis-attributes one that
 *    did. `assistant/attempt` is where an abandoned or retried attempt lands,
 *    so ignoring it silently dropped real billable calls.
 *  - `llm/retry-started` is handled by the caller, which closes the
 *    replacement slot; see {@link applyUsageDelta}.
 *
 * @param event - one session event.
 * @returns the sample and its `turn:step` key, or undefined.
 */
function sampleOf(event) {
	const kind = event.type === "assistant/attempt" ? SAMPLE_ATTEMPT : SAMPLE_SUCCESS;
	if (event.type === "assistant/message" && event.data?.usage !== void 0) {
		return {
			key: `${event.data.turn}:${event.data.step}`,
			usage: event.data.usage,
			kind
		};
	}
	if (event.type !== "assistant/message" && event.type !== "assistant/attempt") return void 0;
	const usage = lastUsageChunkOf(event.data?.stream);
	if (usage === void 0) return void 0;
	return {
		key: `${event.data.turn}:${event.data.step}`,
		usage,
		kind
	};
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

/**
 * 样本归属：`assistant/message` 与 `assistant/attempt` 都是一次模型尝试的结算，
 * 但只有前者产出 surface message。「失败数」「生成速度」这些口径都要区分两者，
 * 所以在样本上挂一个符号，而不是再往持久化状态里塞一个字符串字段。
 */
const SAMPLE_SUCCESS = "message";
const SAMPLE_ATTEMPT = "attempt";

/** 取（必要时建立）某天某模型的桶：token 四桶 + 计数器，形状必须一致。 */
function modelBucketOf(entry, model) {
	let bucket = entry.models.get(model);
	if (bucket === void 0) {
		bucket = zeroModelBucket();
		entry.models.set(model, bucket);
	}
	return bucket;
}

/** Day entry: token totals, per-model buckets, counters, compacted estimate. */
function entryOf(byDay, day) {
	let entry = byDay.get(day);
	if (entry === void 0) {
		entry = {
			totals: zeroBuckets(),
			models: new Map(),
			...zeroCounters(),
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
		/**
		 * 已重试过、但还没等到最终产出的 step（key 为 turn:step）。
		 *
		 * 「重试后成功」跨越两个事件类型：llm/retry-started 说明这一 step 重试过，
		 * assistant/message 说明它最终产出了。判定必须能跨增量折叠的边界——一次
		 * 折叠的结尾正好落在 retry-started 上，下一次折叠才看到那条 message。
		 * 记在状态里而不是当场配对，就是为了这件事；只有重试过且未收口的 step
		 * 会留在这里，量级是常数。
		 */
		pendingRetries: new Set(),
		/**
		 * 已结束 step 的起点时间，只留最近若干条（上限见 {@link RETAINED_STEP_STARTS}）。
		 *
		 * openSteps 在 step/end 就删，而首字延迟要拿 step 起点当减数。正常顺序里结算
		 * 事件排在 step/end 之前，够用；但同一个 (turn, step) 被重报时（attempt 与最终
		 * message 共用 key，或跨进程重折），重报发生在 step/end 之后，起点已经没了——
		 * 于是"替换旧样本"时减掉了旧的首字延迟，新的却算不出来，这个指标会越跑越小。
		 * 留一小段已结束的起点正好覆盖这类迟到重报；上限压死意味着持久化体积不随
		 * 会话增长（v7 正是为了这点删掉了全量 step 区间）。
		 */
		recentStepStarts: new Map(),
		/**
		 * 进行中 step 的首个 token 时刻（key 为 turn:step，多次 run 取最早）。
		 *
		 * 真实日志里流式片段是**独立事件**（reasoning-chunks / text-chunks /
		 * tool-call-chunks），assistant/message 本身上只有 usage，不带 stream。
		 * 所以首字时刻只能在折叠流式事件时记下来，等同一 (turn, step) 的结算事件
		 * 到达时取用；结算完就删，留下的只有「还没结算的 step」，量级是常数。
		 */
		streamFirstToken: new Map(),
		/**
		 * 已结算 step 的首字时刻，最近若干条（与 recentStepStarts 同寿同量级）。
		 *
		 * 主 map 结算即删是必须的（否则它会攒到与全历史 step 同量级），但删干净会
		 * 留一个洞：同一 (turn, step) 的结算被**重报**时（跨进程重折、日志重放），
		 * 旧的首字延迟被"替换"逻辑减掉、新的却因为首字时刻已删而算不出来，这个
		 * 指标会越跑越小。留一小段已结算的首字时刻正好补上这个洞。
		 */
		recentFirstTokens: new Map(),
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
		// 这里的 usage 样本要解析两次（计数兜底 + token 累加），而解析一次就要
		// 反向扫完整条 stream。只算一遍，两条路径共用同一个对象。
		const sample = sampleOf(event);
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
		// 重试：新的 attempt 会为同一个 (turn, step) 再报一次 usage，但那是第二次
		// 真实调用、第一次的 token 也照样计费。不关掉替换槽的话，新样本会被当成
		// 「同一轮的重新上报」而减掉旧值——重试一次就凭空少算一份用量。官方
		// tokenUsage 投影用同一条规则（usage-projection.ts 的 llm/retry-started
		// 分支），这里跟着它走，两个数字才对得上。
		if (event.type === "llm/retry-started") {
			if (last !== null && last.key === `${event.data.turn}:${event.data.step}`) last = null;
		}
		// 调用次数与失败数：每一条 assistant/message / assistant/attempt 计一次
		// （与 usage 无关，没上报 token 的响应同样计入）。有 usage 样本的结算
		// 由下面的样本路径统一计数——那里必须能按同一样本整份撤销，否则重报
		// 会让计数器翻倍；这里只兜住「结算了但一个字都没报」的那部分。
		// assistant/attempt 是没能产出 surface message 的尝试结算（失败 / 重试 /
		// 取消 / 流错误），与 requests 不相交，两者相加才是总尝试次数（分母）。
		if (event.type === "assistant/message" || event.type === "assistant/attempt") {
			const entry = entryOf(state.days, dayKey(event.time));
			if (sample === void 0) {
				const fallbackModel = modelOf(event) ?? currentModel ?? "unknown/unknown";
				const bucket = modelBucketOf(entry, fallbackModel);
				if (event.type === "assistant/attempt") {
					entry.failed += 1;
					bucket.failed += 1;
				} else {
					entry.requests += 1;
					bucket.requests += 1;
				}
			}
			// 重试收口：这一步先前重试过，而这一条 assistant/message 就是那次重试
			// 最终成功产出的结果。重试的意图与结果落在两个事件上，只能这样配对。
			if (event.type === "assistant/message") {
				const stepKey = `${event.data?.turn}:${event.data?.step}`;
				if (state.pendingRetries.has(stepKey)) {
					state.pendingRetries.delete(stepKey);
					entry.retriedSuccess += 1;
				}
			}
		}
		// 重试次数与「待收口重试」。注意顺序：本事件关掉 usage 替换槽的记录
		// 在下面（保持既有语义），这里只做计数与配对。
		if (event.type === "llm/retry-started") {
			entryOf(state.days, dayKey(event.time)).retries += 1;
			state.pendingRetries.add(`${event.data?.turn}:${event.data?.step}`);
		}
		// 工作时长：step/start 与 step/end 配对，跨 fold 边界的未闭合 step
		// 由 state.openSteps 携带。step 区间本身不再留存——它只用来算 workMs，
		// 而 workMs 没有任何消费者；每个 step 留一条 [start,end] 却是持久化
		// 缓存里最大的一块（4.5MB 的主体），并且每轮聚合都要把它们拷进全局
		// 天桶再排序一遍。openSteps 仍要留：它只有未闭合的 step，量级是常数。
		// 首字时刻：流式片段是独立事件，趁折叠时把每个 step 最早的那片记下来。
		// 一个 step 可能有多个 run（先推理后正文、多次工具调用），首字指其中最早的一个。
		if (STREAM_RUN_TYPES.has(event.type)) {
			const runKey = `${event.data?.turn}:${event.data?.step}`;
			const first = runEventFirstTokenTime(event);
			if (first !== void 0) {
				const previous = state.streamFirstToken.get(runKey);
				if (previous === void 0 || first < previous) state.streamFirstToken.set(runKey, first);
			}
		}
		if (event.type === "step/start") {
			state.openSteps.set(`${event.data.turn}:${event.data.step}`, event.time);
		} else if (event.type === "step/end") {
			const stepKey = `${event.data.turn}:${event.data.step}`;
			const start = state.openSteps.get(stepKey);
			state.openSteps.delete(stepKey);
			if (Number.isFinite(start)) rememberBounded(state.recentStepStarts, stepKey, start);
		}
		if (sample === void 0) continue;
		const buckets = bucketsOf(sample.usage);
		const model = modelOf(event) ?? currentModel ?? "unknown/unknown";
		const day = dayKey(event.time);
		const entry = entryOf(state.days, day);
		if (last !== null && last.key === sample.key) {
			// Same turn/step re-reported: replace instead of double counting.
			// 计数字段必须跟着 token 一起撤销：同一次结算里新样本（例如最终的
			// assistant/message 覆盖先前那条 attempt）会让 requests/failed 等
			// 换个口径重记一遍，不回滚旧的那份就是重复计数。
			const previous = state.days.get(last.day);
			if (previous !== void 0) {
				subtractFrom(previous.totals, last.buckets);
				subtractCounters(previous, last.counters);
				const previousModel = previous.models.get(last.model);
				if (previousModel !== void 0) {
					subtractFrom(previousModel, last.buckets);
					subtractModelCounters(previousModel, last.counters);
				}
			}
		}
		addInto(entry.totals, buckets);
		// 新样本的计数：成功结算 = 一次请求，失败结算 = 一次失败。
		const counters = zeroCounters();
		if (sample.kind === SAMPLE_ATTEMPT) counters.failed = 1;
		else counters.requests = 1;
		// 计时：只有成功结算参与。失败/取消的 attempt 没有"输出速度"可言，把它们的
		// 时长混进分母只会让这个数偏低，而且对不上用户看到的"每秒多少 token"。
		// 两个量共用同一个首 token 时刻，但起点不同：首字延迟从 step 起点算（用户
		// 等多久才开始出字），生成时长从首 token 算（出字本身多快）。
		if (sample.kind !== SAMPLE_ATTEMPT) {
			// 首 token 时刻优先取折叠流式事件时记下的值（真实日志里 assistant/message
			// 不带 stream，只有 assistant/attempt 才带）；两者都试一遍，取先到的。
			const fromEvents = state.streamFirstToken.get(sample.key) ?? state.recentFirstTokens.get(sample.key);
			const fromStream = firstTokenTime(event.data?.stream);
			const firstToken = fromEvents === void 0 ? fromStream
				: fromStream === void 0 ? fromEvents
				: Math.min(fromEvents, fromStream);
			if (firstToken !== void 0) {
				// step 起点：先查未闭合的 step，再查刚结束的那一段（覆盖迟到的重报）。
				// 都取不到就直接不计——宁缺勿造，补 0 会被读成"首字零延迟"。
				const stepStart = state.openSteps.get(sample.key) ?? state.recentStepStarts.get(sample.key);
				if (Number.isFinite(stepStart) && firstToken >= stepStart) {
					counters.ttftMs = firstToken - stepStart;
					counters.ttftSteps = 1;
				}
				// 生成时长过短的样本不计：tool-call 为主的 step 会在首片之后立刻结算，
				// 分母几十毫秒而分子是整个 outputTokens，除出来的「每秒两万 token」
				// 不是速度而是分母太小。100ms 以下测不出吞吐，与其截断速率（伪造一个
				// 数字）不如承认这一条测不到——分子分母都不进账，聚合值才不会被污染。
				const genMs = event.time - firstToken;
				if (genMs >= MIN_GEN_MS) {
					counters.genMs = genMs;
					counters.genTokens = buckets.outputTokens;
				}
			}
			// 主 map 结算即删：它只该留「进行中、还没结算」的 step，否则会长到与全历史
			// step 同量级。删之前把首字时刻挪进有界缓存，供迟到重报重算 ttft/genMs。
			const settled = state.streamFirstToken.get(sample.key);
			state.streamFirstToken.delete(sample.key);
			if (settled !== void 0) rememberBounded(state.recentFirstTokens, sample.key, settled);
			else if (fromStream !== void 0) rememberBounded(state.recentFirstTokens, sample.key, fromStream);
		}
		addCounters(entry, counters);
		// 模型桶要同时收 token 与计数：少了这行 addInto，天级 token 是对的、模型级
		// 全是 0（拆分列表与费用卡因此整列归零），而重报时 subtractFrom 又照常从
		// 模型桶里扣——扣一个从没加过的数，模型级 token 会越跑越负。
		const modelBucket = modelBucketOf(entry, model);
		addInto(modelBucket, buckets);
		addModelCounters(modelBucket, counters);
		last = { key: sample.key, day, hour: hourKey(event.time), model, buckets, counters };
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
		// 计数器逐个累加（缺字段按 0）：老缓存里没有这些字段时，合并结果就是
		// 「未知」而不是 NaN，整个大盘也不会因为一份旧会话而整列崩掉。
		addCounters(target, entry);
		target.compacted += entry.compacted ?? 0;
		for (const [model, bucket] of entry.models) {
			const targetBucket = modelBucketOf(target, model);
			addInto(targetBucket, bucket);
			addModelCounters(targetBucket, bucket);
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
				.map(([model, bucket]) => ({
					model,
					...bucketsOf(bucket),
					...modelCountersOf(bucket),
					tokens: totalTokens(bucket),
					cacheHitRate: cacheHitRate(bucket)
				}))
				.sort((a, b) => b.tokens - a.tokens);
			return {
				date,
				...entry.totals,
				// 计数器**展开**而不是逐字段点名：以后再加一个口径不需要改四处
				// 展开点，漏掉一处的后果是新字段在响应里静默消失。
				...countersOf(entry),
				tokens: totalTokens(entry.totals),
				cacheHitRate: cacheHitRate(entry.totals),
				compacted: entry.compacted ?? 0,
				models
			};
		})
		.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
	const total = zeroBuckets();
	const totalCounters = zeroCounters();
	let totalCompacted = 0;
	for (const [, entry] of byDay) {
		addInto(total, entry.totals);
		addCounters(totalCounters, entry);
		totalCompacted += entry.compacted ?? 0;
	}
	return {
		days,
		total: {
			...total,
			...totalCounters,
			tokens: totalTokens(total),
			cacheHitRate: cacheHitRate(total),
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
