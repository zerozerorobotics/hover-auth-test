# Session Sync V4 — 边界场景与风险分析

## 🔴 场景 1: Safari ITP — 已登录用户被误踢

```
条件: Safari 浏览器 + 已登录用户
流程: visibilitychange → iframe → Keycloak 无法读取自身 Cookie → 返回 inactive
结果: 已登录用户被错误退出 → 再次登录 → iframe 又报 inactive → 循环退出
边界: Safari 14+ 默认开启 ITP
```

**严重度**: 🔴 高 — 直接导致 Safari 用户无法保持登录

---

## 🟠 场景 2: Eager Redirect 残留参数

```
条件: Phase 1 成功后，URL 变为 example.com/?code=xxx&state=PROBE
流程: 下次加载 → window.location.href 仍含 ?code= → 作为 redirect_uri 发给 Keycloak
结果: Keycloak 可能拒绝该 redirect_uri（不在白名单中）
边界: redirect_uri 白名单配置是否支持带参数的 URL
```

**严重度**: 🟠 中 — 取决于 Keycloak 的 redirect_uri 匹配策略（通配符 vs 精确）

---

## 🟠 场景 3: Iframe + Logout 同步的循环退出

```
条件: 退出跳转后 return_to 回到当前页 → 页面重新加载 → iframe 检查
流程: logout → return_to=/ → 页面加载 → init() → iframe 检查 → inactive → 又退出?
边界: 退出后 STATE.isLoggedIn 应变为 false（Liquid 重新渲染）
       ✅ Liquid 正确返回 false → 走匿名分支 → 不触发退出
       ❌ 缓存导致 Liquid 仍返回 true → 循环退出
```

**严重度**: 🟠 中 — 取决于 Shopify 页面缓存行为

---

## 🟠 场景 4: Cloudflare Worker 不可用

```
条件: Worker 宕机 / CDN 故障
流程: iframe 加载失败 → 无 postMessage → 10s 后 iframe 被删除 → 静默失败
结果: 登录同步和退出同步都不工作，但不会崩溃
边界: Worker 可用性 SLA
```

**严重度**: 🟡 低 — 降级为无同步，不影响当前站点功能

---

## 🟡 场景 5: 多 Tab 同时触发退出

```
条件: 用户在 Site B 开了 3 个 Tab，Site A 退出
流程: 切回任一 Tab → iframe 检查 → inactive → logout
       3 个 Tab 同时或先后跳转退出
结果: 多次 logout 请求（无害，但有冗余）
边界: Tab 数量 × 切换频率
```

**严重度**: 🟢 无害

---

## 🟡 场景 6: Hint Cookie 被手动清除

```
条件: 用户手动清理 Cookie 或浏览器扩展清除
流程: Site B 匿名用户 → 无 Hint Cookie → Phase 1 跳过 → Phase 2 iframe 检查
结果: 仍能通过 iframe 同步登录，只是少了 Eager Redirect 快路径
边界: Cookie 清除频率
```

**严重度**: 🟢 无害 — Phase 2 兜底

---

## 边界总结

| 边界 | 安全侧 | 危险侧 |
|------|--------|--------|
| **浏览器** | Chrome/Edge/Firefox | Safari (ITP) |
| **缓存** | Shopify 无页面缓存 | CDN/Edge 缓存致 `customer` 状态陈旧 |
| **网络** | Worker 正常 | Worker 宕机 → 静默降级 |
| **redirect_uri** | Keycloak 通配符匹配 | 精确匹配 + 残留参数 → 被拒 |
| **退出后页面状态** | Liquid 正确判断 `customer=null` | 缓存旧值 → 循环退出 |

## 优先级

1. 🔴 **Safari ITP** — 需要 fallback 方案（fetch 或跳过 iframe 检查）
2. 🟠 **redirect_uri 参数清理** — Phase 1 中清理 `window.location.href` 的残留参数
3. 🟠 **循环退出** — 确认 Shopify 页面无缓存，或加 sessionStorage 防循环 flag
