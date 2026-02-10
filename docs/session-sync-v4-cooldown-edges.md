# Session Sync V4 — 冷却期边界分析

## 两个冷却期

| 冷却期 | 位置 | 值 | 存储 |
|--------|------|-----|------|
| Eager Redirect | Phase 1 | 60s | `sessionStorage: keycloak_v4_eager_ts` |
| Iframe Check | Phase 2 | 5s | `STATE.lastIframeProbeAt` + `sessionStorage` |

---

## Eager Redirect — 60s 冷却期

### 问题场景: 先失败后成功

```
0s:  匿名用户打开 Site B → Eager Redirect → Keycloak → ?error=login_required
     (Keycloak Session 恰好过期)
     cooldown 记录时间戳

30s: 用户在 Site A 重新登录 → KC_LOGGED_IN=1

35s: 用户刷新 Site B → Eager Redirect?
     → ❌ cooldown 还剩 25s → 跳过
     → 走 Phase 2 iframe (5s 后) → active → redirect login ✅
```

**边界**: 用户在 60s 内先失败后成功。
**后果**: 不严重 — Phase 2 iframe 兜底，只比 Eager Redirect 慢 1-2s。

---

## Iframe Check — 5s 冷却期

### 问题场景 A: 退出同步延迟

```
0s:  切到 Site B → iframe 检查 → active
3s:  Site A 退出 Keycloak
4s:  切回 Site B → visibilitychange → cooldown 没过 → 跳过 ⚠️
     用户看到仍是登录状态（最多 5s 不一致窗口）
9s:  用户再切一次 → cooldown 过期 → iframe → inactive → 退出 ✅
```

### 问题场景 B: 登录同步延迟

```
0s:  匿名用户打开 Site B → iframe 检查 → inactive
3s:  Site A 登录
4s:  切回 Site B → cooldown 没过 → 跳过 ⚠️
9s:  切回 → cooldown 过期 → iframe → active → 登录 ✅
```

**边界**: 状态变化发生在上一次检查后的 5s 窗口内。
**后果**: 轻微 — 最多 5s 的状态不一致。

---

## 无冷却期的后果

| 无 Cooldown | 后果 |
|-------------|------|
| Eager Redirect = 0s | **灾难性**: Keycloak 返回 error → 页面加载 → 再次 redirect → **无限循环** |
| Iframe Check = 0s | **资源浪费**: 每次 visibilitychange 都创建 iframe + 网络请求 |

---

## 总结

| 冷却期 | 值 | 最坏情况 | 可接受？ |
|--------|-----|---------|---------|
| Eager Redirect | 60s | 登录延迟 60s，iframe 5s 兜底 | ✅ |
| Iframe Check | 5s | 状态不一致窗口 ≤ 5s | ✅ |
| Eager = 0s | - | 无限 redirect 循环 | ❌ |
| Iframe = 0s | - | 大量重复请求 | ❌ |

**核心边界**: 冷却期越短 → 同步越及时 + 循环/资源风险越高。当前 60s/5s 组合在及时性与安全性之间取得合理平衡。
