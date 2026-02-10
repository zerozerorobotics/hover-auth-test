# Session Sync V4 — 模块逻辑分析

## 概述

Session Sync V4 (Hybrid Hint Cookie Strategy) 实现跨域 SSO 同步，核心思路是通过共享 Cookie (`KC_LOGGED_IN`) 在多个 Shopify 站点之间传递 Keycloak 登录状态。

---

## 模块执行流程

```
页面加载 → IIFE 立即执行
  │
  ├── [1] CONFIG / STATE 初始化
  │     └── STATE.isLoggedIn = Liquid {{ customer }} 注入
  │
  ├── [2] Cookie Helper 函数定义
  │     └── getHintCookie / setHintCookie / clearHintCookie
  │
  ├── [3] ★ Phase 1: Eager Redirect (立即执行，不等 DOM)
  │     └── 条件: !isLoggedIn && KC_LOGGED_IN=1 && Cooldown过期
  │           ├── true  → redirect to Keycloak (prompt=none, state=PROBE) → 离开页面
  │           └── false → 继续往下
  │
  ├── [4] 等待 DOM Ready → init()
  │     │
  │     ├── [4a] ★ Phase 0: 已登录用户
  │     │     ├── setHintCookie()
  │     │     └── 启动 Logout Sync (visibilitychange + fetch session-status)
  │     │
  │     └── [4b] ★ Phase 2: 匿名用户 Iframe 检查
  │           ├── checkSession() → createProbeIframe()
  │           ├── visibilitychange → checkSession()
  │           └── message listener → handleIframeMessage()
  │
  └── [5] handleIframeMessage
        ├── status === 'active' → setHintCookie() + redirect login
        └── status !== 'active' → clearHintCookie() (自愈)
```

---

## 三个核心场景

| 场景 | 条件 | 行为 | 目的 |
|------|------|------|------|
| **Phase 0** | `isLoggedIn = true` | `setHintCookie()` + 启动 Logout Sync | Site A 登录后种下共享 Cookie，并监控 Keycloak Session |
| **Phase 1** | `!isLoggedIn && HintCookie && !Cooldown` | Top-Level Redirect (`state=PROBE`) | Site B 发现 Hint → 立即跳 Keycloak 完成登录 |
| **Phase 2** | `!isLoggedIn && (无Hint 或 Cooldown中)` | Iframe 静默检查 via Worker | 兜底检查 + 自愈 Stale Cookie |

---

## 自动上线 vs 自动下线 对比

| 维度 | 自动上线 (Auto Login) | 自动下线 (Auto Logout) |
|------|----------------------|----------------------|
| **触发条件** | `!isLoggedIn && KC_LOGGED_IN=1` | `isLoggedIn && Keycloak Session Inactive` |
| **含义** | Shopify 未登录，但 Keycloak 已登录 | Shopify 已登录，但 Keycloak 已退出 |
| **检测方式** | 读 Cookie (本地，快) | Fetch Keycloak API (网络请求，慢) |
| **触发时机** | 页面加载时立即执行 (Phase 1) | 页面加载 + Tab 切回时 (visibilitychange) |
| **执行动作** | Redirect → Keycloak Auth (prompt=none, state=PROBE) | Redirect → `/customer_authentication/logout` |
| **防循环机制** | sessionStorage Cooldown (60s) | 依赖 `zz_session_id` 存在 |
| **依赖** | KC_LOGGED_IN Cookie (Hint) | `zz_session_id` (localStorage) + Keycloak API |
| **可靠性** | Cookie 是 Hint，可能过期/不准 | Fetch 是权威来源，准确 |

### 核心不对称性

```
自动上线:  Cookie (Hint) → 快速判断 → 立即 Redirect
自动下线:  Fetch (API)   → 网络请求 → 确认后 Redirect
```

**为什么不对称？**

- **上线**: 可以容忍 "误判"。即使 Hint Cookie 过期了，Keycloak `prompt=none` 会返回 `error=login_required`，用户只是没登上，不会有破坏性后果。
- **下线**: **不能容忍 "误判"**。如果因为 Cookie 被意外清除就把用户踢下线，体验极差。所以必须用 **权威来源 (Keycloak API)** 确认。

### 完整流程图

```
                    页面加载
                       │
          ┌────────────┼────────────┐
          │                         │
     !isLoggedIn              isLoggedIn
          │                         │
    KC_LOGGED_IN=1?          setHintCookie()
     ├── Yes → Eager Redirect       │
     │         (Auto Login)    zz_session_id?
     └── No  → Iframe Check    ├── Yes → fetch session-status
              (Phase 2)        │         ├── active=false → Auto Logout
                               │         └── active=true  → 保持
                               └── No  → 无法检查 (静默)
```

---

## 依赖清单

| 依赖 | 用途 |
|------|------|
| `KC_LOGGED_IN` Cookie (`.zerozeroplatform.com`) | 跨域登录 Hint |
| `zz_session_id` (localStorage) | 用于 fetch 验证 Keycloak Session |
| Keycloak Auth URL (`prompt=none`, `state=PROBE`) | 静默登录探测 |
| Keycloak Session Status API (`/hoverair/session-status`) | 退出同步检查 |
| Cloudflare Worker (`static.zerozeroplatform.com/session-check`) | Iframe redirect_uri (绕过 X-Frame-Options) |
| Keycloak SPI Provider | 处理 `state=PROBE` 的特殊逻辑 |
