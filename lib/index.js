// command-session-delete —— 物理删除一个 DSH 会话（不可恢复）
//
// 双半插件：
//   host 半（本文件）：
//     - /session-delete 命令（输入框敲命令删除）
//     - POST /session-delete 路由（webServer 挂载，供 client 半右键菜单调用）
//   client 半（lib/client.js）：
//     - 会话列表右键菜单「删除会话」+ 确认对话框
//
// 删除原理：DSH 产品层只有"归档"（archiveSession），没有删除。
// 本插件复用内部 seam：
//   1. sessionPersistence.locate(meta) 定位会话 JSONL 的绝对路径
//   2. workspace/session-activity 检查会话是否在跑（回合/子代理/任务）
//   3. workspace/session-stop 停止活动（force 时）
//   4. 递归删除整个会话目录
//   5. DSH 重扫时发现会话文件 ENOENT，自动从列表/索引中过滤掉
//
// 注意：删除不可恢复；建议先"归档"再删除，避免误删。

import { access, rm } from "node:fs/promises";
import { dirname } from "node:path";

// 与 @deepseek-ai/dsh-commands/brand 的 CommandDefinitionId 等价（恒等函数）。
// 本地定义以避免运行时依赖，便于从 GitHub 一键安装。
const CommandDefinitionId = (id) => id;

const name = "command-session-delete";
const inject = ["commands", "sessions", "workspaceRegistry", "sessionPersistence"];
const USAGE = "Usage: /session-delete <sessionId> [--force]   (物理删除会话，不可恢复)";

// ─── 共享删除核心 ───────────────────────────────────────────────

/** 从内存服务或持久层找一个会话 header，返回 { id, cwd } 或 null。 */
async function findHeader(ctx, sessionId) {
	const live = ctx.sessions?.get?.(sessionId);
	if (live?.header) {
		return { id: sessionId, cwd: live.header.cwd, path: live.header.location?.path ?? live.location?.path };
	}
	const persistence = ctx.sessionPersistence;
	if (typeof persistence?.list === "function") {
		const snapshots = await persistence.list();
		// list() 返回 snapshot 数组：header 在 .header 字段中，location.path 是真实落盘路径
		const match = snapshots?.find?.((entry) => (entry?.header?.id ?? entry?.id) === sessionId);
		if (match) {
			const header = match.header ?? match;
			return { id: sessionId, cwd: header.cwd, path: match.location?.path ?? header.location?.path };
		}
	}
	return null;
}

/** 会话当前是否处于活跃状态（复用归档时的活动检测）。 */
async function activityOf(ctx, sessionId) {
	if (typeof ctx.waterfall !== "function") return [];
	try {
		const activity = await ctx.waterfall("workspace/session-activity", { sessionId }, () => Promise.resolve([]));
		return Array.isArray(activity) ? activity : [];
	} catch {
		return [];
	}
}

/** 停止会话活动（force 路径）。 */
async function stopActivityOf(ctx, sessionId) {
	if (typeof ctx.waterfall !== "function") return;
	try {
		await ctx.waterfall("workspace/session-stop", { sessionId }, () => Promise.resolve());
	} catch {
		// 停止失败不阻塞删除尝试；文件句柄占用由 rm 阶段兜底
	}
}

/** 定位并递归删除会话目录。返回被删除的目录路径。 */
async function deleteSessionDir(ctx, meta) {
	let sessionDir;
	if (meta.path) {
		// 优先使用 list() 实测到的落盘路径；带 generation 文件名则取其目录
		sessionDir = /\.[a-zA-Z0-9]+$/.test(meta.path) ? dirname(meta.path) : meta.path;
	} else {
		const persistence = ctx.sessionPersistence;
		if (typeof persistence?.locate !== "function") {
			throw new Error("sessionPersistence.locate() 不可用，此 DSH 版本可能不兼容本插件");
		}
		const { path } = persistence.locate(meta);
		if (!path) throw new Error("无法定位该会话的存储文件");
		sessionDir = dirname(path);
	}
	await access(sessionDir);
	await rm(sessionDir, { recursive: true, force: true });
	return sessionDir;
}

/**
 * 执行删除。返回 { ok: true, dir } 或 { ok: false, message }（永远不抛）。
 *
 * 关键步骤：先调用官方 workspaceRegistry.archiveSession 把会话"归档"——这会
 * 通过 workspace/follow 事件流把归档状态广播给前端，React 据此正常移除侧栏
 * 行（前端不碰 DOM，渲染树不会坏）。随后再物理删除磁盘上的会话目录。
 * 归档集合里残留一个 id 无害：文件已删，重启后 header 索引重建时自动过滤。
 *
 * @param {object} ctx - host 上下文
 * @param {string} sessionId - 会话 id
 * @param {{force?: boolean}} [options] - force 时先停止会话活动
 */
async function performDelete(ctx, sessionId, options = {}) {
	if (!sessionId || typeof sessionId !== "string" || /\s/.test(sessionId)) {
		return { ok: false, message: "sessionId 缺失或非法" };
	}
	const header = await findHeader(ctx, sessionId);
	if (!header) {
		return { ok: false, message: `会话 ${sessionId} 不存在（既不在内存也不在持久层）。` };
	}

	// 1) 官方归档通道：停止活动（force 时）并让前端列表正常更新
	const registry = ctx.workspaceRegistry;
	if (registry && typeof registry.archiveSession === "function") {
		try {
			await registry.archiveSession(sessionId, options.force === true ? { stopActivity: true } : {});
		} catch (error) {
			// WorkspaceActiveSessionError → 会话正在活动（仅非 force 时可能）
			if (error?.name === "WorkspaceActiveSessionError" || /is the session is active|active \(/.test(String(error?.message ?? error))) {
				return {
					ok: false,
					message: `会话 ${sessionId} 正在活动。请先停止或归档后再删除。`,
				};
			}
			if (/(session|会话).*(not found|不存在)|unknown session/i.test(String(error?.message ?? error))) {
				return { ok: false, message: `会话 ${sessionId} 无法在注册表中找到，可能已被移除。` };
			}
			return { ok: false, message: `归档步骤失败：${error instanceof Error ? error.message : String(error)}` };
		}
	}

	// 2) 物理删除磁盘上的会话目录（归档后文件句柄通常已释放）
	try {
		const dir = await deleteSessionDir(ctx, header);
		return { ok: true, dir, archived: true };
	} catch (error) {
		if (error?.code === "EBUSY" || error?.code === "EPERM") {
			return {
				ok: false,
				message: `会话文件被占用（可能有写句柄，比如该会话还在跑或刚被打开）。会话已先归档（列表已隐藏，可恢复）；请先停止该会话或重启 DSH 后再删除。`,
			};
		}
		if (error?.code === "ENOENT") {
			return { ok: true, dir: "(存储文件已不存在，视为已清理)", archived: true };
		}
		return { ok: false, message: error instanceof Error ? error.message : String(error) };
	}
}

// ─── /session-delete 命令 ───────────────────────────────────────

async function executeDelete(ctx, invocation) {
	const raw = invocation.rawInput.trim();
	const force = /\s--force\s*$/.test(raw) || raw === "--force";
	const sessionId = raw.replace(/\s*--force\s*$/i, "").trim();
	const result = await performDelete(ctx, sessionId, { force });
	if (!result.ok) return { kind: "error", text: result.message };
	return {
		kind: "success",
		text: `已删除会话 ${sessionId}。\n存储目录：${result.dir}\n重启 DSH 后它会从列表和索引中彻底消失（不可恢复）。`,
	};
}

// ─── webServer 路由（client 半右键菜单调用）────────────────────

function installDeleteRoute(ctx) {
	ctx.inject(["webServer"], (subCtx) => {
		let ws = null;
		try {
			ws = subCtx.webServer ?? (typeof subCtx.get === "function" ? subCtx.get("webServer") : undefined);
		} catch {
			ws = undefined;
		}
		if (!ws || typeof ws.register !== "function") {
			ctx.logger?.warn?.("[command-session-delete] webServer 不可用，右键菜单删除功能未挂载（命令 /session-delete 仍可用）");
			return;
		}
		let dispose = null;
		try {
			dispose = ws.register({
				kind: "prefix",
				path: "/session-delete",
				handler: (req, res) => {
					if (req.method !== "POST") {
						res.writeHead(405, { "content-type": "application/json" });
						res.end(JSON.stringify({ ok: false, message: "method not allowed" }));
						return;
					}
					const chunks = [];
					req.on("data", (c) => {
						if (chunks.length < 32) chunks.push(c);
					});
					req.on("end", async () => {
						let payload;
						try {
							payload = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
						} catch {
							res.writeHead(400, { "content-type": "application/json" });
							res.end(JSON.stringify({ ok: false, message: "bad json body" }));
							return;
						}
						const result = await performDelete(ctx, payload.sessionId, { force: payload.force === true });
						res.writeHead(200, { "content-type": "application/json" });
						res.end(JSON.stringify(result));
					});
					req.on("error", () => {
						try {
							res.writeHead(500, { "content-type": "application/json" });
							res.end(JSON.stringify({ ok: false, message: "request error" }));
						} catch { /* already gone */ }
					});
				},
			});
		} catch (error) {
			ctx.logger?.warn?.("[command-session-delete] 路由挂载失败:", error);
		}
		return () => {
			try {
				if (typeof dispose === "function") dispose();
			} catch { /* route already gone */ }
		};
	});
}

// ─── 插件入口 ──────────────────────────────────────────────────

function apply(ctx) {
	installDeleteRoute(ctx);
	ctx.effect(function* () {
		yield ctx.commands.register({
			definitionId: CommandDefinitionId("@local/command-session-delete"),
			name: "session-delete",
			description: "物理删除一个会话（不可恢复）；--force 先停止活动",
			handler: (invocation) => executeDelete(ctx, invocation),
		});
	}, "command-session-delete lifecycle");
}

export { apply, inject, name };