# Session Sync V4 — 退出同步 (Logout Sync) 分析

## 问题背景

V4 的 `init()` 中，已登录用户 (`isLoggedIn=true`) 仅执行 `setHintCookie()` 后立即 `return`，
**没有设置任何监听器**，导致跨站退出同步无法工作。

---

## 核心问题：`zz_session_id` 无写入时机

### V1 的 sid 写入链路

```
匿名用户 → PROBE (state=PROBE) → Keycloak SPI → redirect ?sid=xxx → JS 捕获 → localStorage
```

### V4 的缺失

PROBE 只在 `!isLoggedIn` 时触发。用户通过标准 OIDC 流程登录时，`state=PROBE` 不参与，
因此 **`zz_session_id` 永远不会被写入**。

| 场景 | PROBE 是否执行 | sid 是否写入 |
|------|---------------|-------------|
| 用户主动点击"登录" | ❌ 标准 OIDC，非 PROBE | ❌ |
| Site B Eager Redirect | ✅ state=PROBE | ✅ (如果 SPI 注入) |
| Iframe 检查 | ❌ iframe postMessage | ❌ |
| 已登录用户刷新页面 | ❌ isLoggedIn=true，跳过 | ❌ |

**结论**: 依赖 `zz_session_id` 的 fetch 方案在最常见的 "用户主动登录" 场景中无法工作。

---

## 方案对比

### 方案 A: Fetch session-status (V1 做法)

```
visibilitychange → fetch Keycloak /hoverair/session-status?token=sid → active/inactive
```

| 优点 | 缺点 |
|------|------|
| 权威来源，100% 准确 | 依赖 `zz_session_id`，写入链路断裂 |
| 轻量，~100-300ms | 需要 Keycloak 自定义 SPI |
| 无跨域 Cookie 限制 | 需要在所有登录流程中注入 sid |

### 方案 B: Iframe Check (OIDC Session Management 标准)

```
visibilitychange → 创建 iframe → Keycloak Auth (prompt=none) → Worker postMessage → active/inactive
```

| 优点 | 缺点 |
|------|------|
| 符合 OIDC 标准 | 延迟较大 (~500-2000ms) |
| 不依赖 `zz_session_id` | Safari ITP 阻止第三方 Cookie |
| 复用已有 Phase 2 逻辑 | iframe 创建销毁有开销 |

### 方案 C: Cookie 检测

```
visibilitychange → 检查 KC_LOGGED_IN Cookie → 消失 → 触发退出
```

| 优点 | 缺点 |
|------|------|
| 最快，无网络请求 | 不权威，Cookie 可能被浏览器意外清除 |
| 实现最简单 | 依赖退出流程必须清除 Cookie |
| 无 Safari 兼容问题 | 误判风险：Cookie 被清 ≠ Keycloak 退出 |

---

## 推荐方案：统一 Iframe Check

### 理由

1. **消除 `zz_session_id` 依赖** — 最根本的问题
2. **复用已有代码** — Phase 2 的 `createProbeIframe()` + `handleIframeMessage()` 可以同时服务于登录和退出检测
3. **符合 OIDC 标准** — OpenID Connect Session Management 规范推荐的做法

### 统一流程

```
                    页面加载
                       │
          ┌────────────┼────────────┐
          │                         │
     !isLoggedIn              isLoggedIn
          │                         │
  Phase 1: Eager Redirect    setHintCookie()
  Phase 2: Iframe Check      Phase 2: Iframe Check ← 复用
          │                         │
  active → login             inactive → logout
  inactive → 保持             active → 保持
```

### 延迟影响

退出同步场景的延迟 (~1-2s) 完全可接受：
- 用户切回 Tab → visibilitychange → Iframe 检查 → 1-2 秒后退出
- 不影响用户体验

---

## Safari ITP 兼容问题

**风险**: Safari 的 ITP (Intelligent Tracking Prevention) 会阻止 iframe 内的第三方 Cookie。
Keycloak 在 iframe 内无法读到自己的 session cookie → 始终返回 `inactive` →
**已登录用户会被错误踢出**。

### 分阶段处理

| 阶段 | 策略 |
|------|------|
| 当前 (测试阶段) | 仅用 Iframe Check，Chrome/Edge/Firefox 验证 |
| 后续 (Safari 兼容) | Iframe 超时/失败时 fallback 到 fetch (需解决 sid 注入) |

---

## 待办事项

- [ ] 修改 `init()` 的 `isLoggedIn` 分支，使用 Iframe Check 替代 fetch
- [ ] `handleIframeMessage()` 增加已登录用户的退出处理逻辑
- [ ] 测试 Chrome/Edge 下的退出同步
- [ ] 评估 Safari ITP 影响并制定兜底方案
