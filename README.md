# command-session-delete

**DSH 插件 · 右键删除会话 · 物理删除，不只是归档**

给 **DeepSeek Harness (DSH)** 的会话列表加一个「**删除会话**」右键菜单，并支持命令删除。

> **为什么需要它**：DSH 产品层对会话只提供「归档」（archive）——归档只是从列表隐藏，记录仍永久保留在磁盘上。工作区的「删除」也只移除分组、不碰会话。本插件补上真正需要的那个动作：**物理删除**。

---

## English

A **DeepSeek Harness (DSH)** plugin that adds a real **Delete Session** action to the session context menu — DSH natively only offers *archive*, which hides a session but keeps it on disk forever.

- Right-click any session → **删除会话 / Delete session** → confirmation dialog → physical deletion
- Command form: `/session-delete <sessionId> [--force]`
- No page reload after deletion; the sidebar row disappears immediately
- Zero runtime dependencies; installable from this GitHub URL via **Plugins → Install plugin**

**Keywords**: DeepSeek Harness, DSH plugin, dsh-plugin, delete session, remove conversation, session management, context menu, physical deletion, archive vs delete

---

## 功能

| 方式 | 操作 |
|---|---|
| **右键菜单** | 会话列表右键 → 「删除会话」→ 确认弹窗 → 物理删除 |
| **命令** | `/session-delete <sessionId>` 或 `/session-delete <sessionId> --force` |

删除成功后：

- 侧栏对应会话行立即消失（**不整页刷新**）
- 右下角显示轻提示
- 磁盘上的会话目录被递归删除
- 重启 DSH 后该会话从列表与索引彻底消失

---

## 安装

### 方式一：插件市场（推荐）

DSH 里打开 **插件 → 安装插件**，输入本仓库链接：

```
https://github.com/alst123/dsh-session-delete
```

安装完成后**重启 DSH** 即可生效（宿主半与前端半都要重启加载）。

### 方式二：手动克隆

```powershell
cd <任意位置>
git clone https://github.com/alst123/dsh-session-delete.git
```

把目录放进插件目录后，在 DSH profile 的 `package.json` 里加依赖：

```json
"command-session-delete": "file:../../plugins/command-session-delete"
```

再在 profile 的 `cordis.patch.yml` 追加：

```yaml
- insert:
    - id: command-session-delete
      name: 'command-session-delete'
```

然后 `pnpm install` 并重启 DSH。

---

## 使用

1. 会话列表里**右键**任意会话
2. 菜单底部（归档下面）出现「**删除会话**」
3. 点击 → 弹出确认框（显示会话标题、id、不可恢复警告）
4. 点红色「删除会话」

**行为细节：**

- 会话**正在运行**（有回合 / 子代理 / 任务）时，菜单删除会先停止其活动再删除
- 文件被占用（写句柄）会拒绝并提示，重启 DSH 后再删即可
- 命令方式支持 `--force` 强制停活动

---

## 卸载

插件市场里移除，或手动：

1. 从 profile 的 `package.json` 删掉依赖
2. 从 profile 的 `cordis.patch.yml` 删掉对应条目
3. `pnpm install`，重启 DSH

---

## ⚠️ 注意事项

- **不可恢复**：物理删除，没有回收站。重要会话请先归档或备份。
- **依赖内部接口**：本插件复用 DSH 的内部 seam（`sessionPersistence.locate()` / `workspace/session-activity` / `workspace/session-stop` / webServer 路由）。DSH 大版本升级后如失效，需要按新接口适配。
- **适配版本**：`@deepseek-ai/dsh` >= 0.2.0-rc.1 < 0.3.0-0
- **删除后列表缓存**：不刷新页面，所以 React 内存里可能还留着旧快照；重启 DSH 后彻底干净。

---

## 实现说明

```
lib/index.js   宿主半：删除核心 + /session-delete 命令 + POST /session-delete 路由
lib/client.js  前端半：右键菜单注册 + 确认弹窗（纯 DOM，无框架依赖）
cordis.patch.yml  bundle patch：把宿主半插入 Loader
```

删除流程：右键 → 确认 → 前端 `fetch POST /session-delete` → 宿主定位会话 JSONL 目录 → 活跃检查 → 停止活动 → 递归删除目录 → DSH 重扫时按 ENOENT 自动过滤。

## License

MIT
