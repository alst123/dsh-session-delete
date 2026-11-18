(() => {
  try {
    /* command-session-delete —— client 半 (v3)
       会话列表右键菜单「删除会话」+ 确认对话框。
       v3: 删除成功后不再整页刷新（避免 Loading plugins），
           只移除侧栏对应行 + 轻提示。 */
    window.__ModuleLoader__.load({
      id: "command-session-delete",
      factory: (require) => {
        var module = { exports: {} };
        var exports = module.exports;
        Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

        var inject = ["contextMenus", "locale"];

        var CSS = `
.csd-overlay{position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.45);backdrop-filter:blur(2px);}
.csd-dialog{width:440px;max-width:92vw;background:#1f2937;border:1px solid rgba(255,255,255,.18);border-radius:10px;box-shadow:0 12px 40px rgba(0,0,0,.5);padding:18px 20px;font:13px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;color:#ffffff;}
.csd-dialog h3{margin:0 0 10px;font-size:14px;font-weight:600;color:#ffffff;}
.csd-dialog p{margin:0 0 4px;color:#d1d5db;}
.csd-dialog .csd-id{font-family:var(--ds-font-family-code,ui-monospace,Menlo,Consolas,monospace);font-size:12px;color:#9ca3af;word-break:break-all;}
.csd-dialog .csd-err{margin-top:10px;color:#fca5a5;font-size:12px;white-space:pre-wrap;}
.csd-dialog .csd-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:16px;}
.csd-btn{border:1px solid rgba(255,255,255,.2);background:#374151;color:#ffffff;border-radius:6px;padding:6px 14px;font-size:13px;cursor:pointer;}
.csd-btn:hover{background:#4b5563;}
.csd-btn:disabled{opacity:.5;cursor:default;}
.csd-btn-danger{border-color:transparent;background:#dc2626;color:#ffffff;}
.csd-btn-danger:hover{background:#ef4444;}
.csd-toast{position:fixed;right:20px;bottom:20px;z-index:10000;max-width:360px;padding:11px 16px 11px 14px;border-radius:8px;background:#1f2937;border:1px solid rgba(255,255,255,.18);border-left:3px solid #22c55e;box-shadow:0 8px 28px rgba(0,0,0,.45);color:#ffffff;font:13px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;opacity:0;transform:translateY(6px);transition:opacity .18s ease,transform .18s ease;}
.csd-toast.csd-show{opacity:1;transform:translateY(0);}
`;

        var activeOverlay = null;
        var toastTimer = null;

        /* ── 轻提示 ── */
        function showToast(text) {
          var old = document.getElementById("csd-toast");
          if (old) old.remove();
          if (toastTimer) { clearTimeout(toastTimer); toastTimer = null; }
          var box = document.createElement("div");
          box.id = "csd-toast";
          box.className = "csd-toast";
          box.setAttribute("role", "status");
          box.textContent = text;
          document.body.appendChild(box);
          requestAnimationFrame(function () { box.classList.add("csd-show"); });
          toastTimer = setTimeout(function () {
            box.classList.remove("csd-show");
            setTimeout(function () { try { box.remove(); } catch (e) { /* ignore */ } }, 220);
          }, 3200);
        }

        /* ── 从侧栏移除已删会话的行（不整页刷新）── */
        function removeSessionRow(sessionId) {
          try {
            var selector = '[data-row-key="session:' + sessionId.replace(/"/g, '\\"') + '"]';
            var rows = document.querySelectorAll(selector);
            if (!rows || rows.length === 0) return false;
            for (var i = 0; i < rows.length; i++) {
              var row = rows[i];
              // 行通常包在一层容器里，优先移除其父容器以不留空白
              var target = row.parentElement && row.parentElement.children.length === 1 ? row.parentElement : row;
              if (target && target.parentElement) target.parentElement.removeChild(target);
              else if (target) target.remove();
            }
            return true;
          } catch (e) {
            return false;
          }
        }

        /* ── 纯 DOM 确认框 ── */
        function showConfirmDialog(target) {
          hideConfirmDialog();

          var overlay = document.createElement("div");
          overlay.className = "csd-overlay";

          var dialog = document.createElement("div");
          dialog.className = "csd-dialog";
          dialog.setAttribute("role", "alertdialog");
          dialog.setAttribute("aria-modal", "true");

          var title = document.createElement("h3");
          title.textContent = "删除会话";

          var desc = document.createElement("p");
          desc.textContent = "将物理删除会话「" + (target.title || "(未命名)") + "」——该操作不可恢复，会话记录、附件引用与相关日志会被永久清除。确认删除？";

          var idLine = document.createElement("div");
          idLine.className = "csd-id";
          idLine.textContent = target.sessionId;

          var errBox = document.createElement("div");
          errBox.className = "csd-err";
          errBox.style.display = "none";

          var actions = document.createElement("div");
          actions.className = "csd-actions";

          var cancelBtn = document.createElement("button");
          cancelBtn.className = "csd-btn";
          cancelBtn.textContent = "取消";
          cancelBtn.addEventListener("click", function () { hideConfirmDialog(); });

          var okBtn = document.createElement("button");
          okBtn.className = "csd-btn csd-btn-danger";
          okBtn.textContent = "删除会话";
          okBtn.addEventListener("click", function () {
            okBtn.disabled = true;
            cancelBtn.disabled = true;
            okBtn.textContent = "删除中…";
            fetch("/session-delete", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ sessionId: target.sessionId, force: true }),
            })
              .then(function (r) { return r.json(); })
              .then(function (result) {
                if (result && result.ok === true) {
                  hideConfirmDialog();
                  // 只移除这一行，不整页刷新
                  var removed = removeSessionRow(target.sessionId);
                  showToast(
                    "已删除会话「" + (target.title || target.sessionId) + "」"
                    + (removed ? "。" : "（列表项可能仍在，重启 DSH 后彻底消失）。")
                  );
                } else {
                  errBox.textContent = (result && result.message) || "删除失败（未知错误）";
                  errBox.style.display = "block";
                  okBtn.disabled = false;
                  cancelBtn.disabled = false;
                  okBtn.textContent = "删除会话";
                }
              })
              .catch(function (error) {
                errBox.textContent = "删除请求失败：" + (error && error.message ? error.message : String(error));
                errBox.style.display = "block";
                okBtn.disabled = false;
                cancelBtn.disabled = false;
                okBtn.textContent = "删除会话";
              });
          });

          actions.appendChild(cancelBtn);
          actions.appendChild(okBtn);
          dialog.appendChild(title);
          dialog.appendChild(desc);
          dialog.appendChild(idLine);
          dialog.appendChild(errBox);
          dialog.appendChild(actions);
          overlay.appendChild(dialog);

          overlay.addEventListener("click", function (e) {
            if (e.target === overlay && okBtn.disabled === false) hideConfirmDialog();
          });
          var onKey = function (e) {
            if (e.key === "Escape" && okBtn.disabled === false) hideConfirmDialog();
          };
          document.addEventListener("keydown", onKey);

          activeOverlay = overlay;
          overlay._cleanup = function () { document.removeEventListener("keydown", onKey); };
          document.body.appendChild(overlay);
        }

        function hideConfirmDialog() {
          if (activeOverlay) {
            try { if (typeof activeOverlay._cleanup === "function") activeOverlay._cleanup(); } catch (e) { /* ignore */ }
            try { activeOverlay.remove(); } catch (e) { /* ignore */ }
            activeOverlay = null;
          }
        }

        /* ── 插件入口 ── */
        function apply(ctx) {
          try {
            if (!document.getElementById("csd-style")) {
              var style = document.createElement("style");
              style.id = "csd-style";
              style.textContent = CSS;
              document.head.appendChild(style);
            }
          } catch (e) { /* ignore */ }

          ctx.effect(function () {
            return ctx.contextMenus.register({
              id: "session.delete",
              target: "session",
              order: 700,
              observe: function () { return [ctx.locale]; },
              resolve: function (target) {
                return [{
                  id: "delete",
                  label: "删除会话",
                  icon: { key: "workspace.delete" },
                  separatorBefore: true,
                  run: function () {
                    showConfirmDialog({ sessionId: target.sessionId, title: target.displayTitle });
                  },
                }];
              },
            });
          }, "command-session-delete: session menu");
        }

        exports.name = "command-session-delete";
        exports.inject = inject;
        exports.apply = apply;
        return module.exports;
      },
    });
  } catch (err) {
    console.warn("[command-session-delete] client runtime error:", err);
  }
})();