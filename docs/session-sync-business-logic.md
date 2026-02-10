# 模块业务逻辑梳理：snippets/session-sync.liquid

该模块的核心业务逻辑是为了实现 **Shopify 商店与 Keycloak 统一认证中心（SSO）的双向会话同步**。

## 核心目标
1.  **自动登录**：如果在 Keycloak 登录了，访问 Shopify 时会自动登录。
2.  **自动登出**：如果在 Keycloak 登出了，Shopify 也会自动登出。

## 详细逻辑流程

### 1. 匿名用户逻辑（自动登录探测）
当用户未在 Shopify 登录时，脚本会执行 "Probe"（探测）流程：
*   **触发条件**：用户访问任意页面且 `customer` 对象为空（即匿名状态）。
*   **防死循环检查**：
    *   检查 `sessionStorage` 中是否有 `keycloak_checked` 标记。
    *   检查距离上次探测是否超过 2 分钟 (`PROBE_COOLDOWN_MS`)。
    *   如果有标记且未过冷却期，则**停止**（避免无限刷新）。
*   **执行动作**：
    *   将当前页面 URL 作为回调地址。
    *   跳转到 Keycloak 的 `/auth` 接口，携带 `prompt=none`（静默模式）和 `state=PROBE`。
*   **预期结果**：
    *   **若 Keycloak 已登录**：Keycloak 返回授权码，Shopify 后端处理登录，用户进入已登录状态。
    *   **若 Keycloak 未登录**：Keycloak 原样跳回，脚本写入 `keycloak_checked` 标记，用户保持匿名继续浏览。

### 2. 已登录用户逻辑（会话保活监控）
当用户已经在 Shopify 登录时，脚本会转为 "Monitor"（监控）模式：
*   **触发条件**：用户已登录 (`customer` 对象存在)。
*   **执行动作**：
    *   从 `localStorage` 获取 `zz_session_id` (Keycloak Session ID)。
    *   调用 `fetch` 请求 Keycloak 的 `/session-status` 接口查询 Session 状态。
*   **触发时机**：
    *   页面加载时。
    *   浏览器标签页由隐藏变为可见时 (`visibilitychange`)。
*   **处理结果**：
    *   **Session 有效**：不做任何操作，保持登录。
    *   **Session 失效**（例如用户在另一个标签页或设备登出）：自动跳转到 Shopify 的 `/account/logout` 执行登出，确保安全。

### 3. 中转页逻辑（Bounce Page）
脚本对 `/pages/session-sync` 路径有特殊处理逻辑，作为登录中转站：
*   **功能**：接收来自 Keycloak 的回调，提取 Session ID，然后跳走。
*   **流程**：
    1.  从 URL Hash 或 Query 参数中提取 `sid`。
    2.  将 `sid` 存入 `localStorage` (用于后续的会话监控)。
    3.  重定向到最终目标页面 (`target` 参数) 或用户中心 (`/account`)。

### 4. 特殊保护机制
*   **显式登出**：如果用户点击了 Shopify 的登出按钮，脚本会写入 `explicit_logout` 标记，禁止在当前会话中再次尝试自动登录，防止用户刚登出又被迫自动登录。
*   **环境区分**：根据域名 (`latentseek.com` vs 其他) 自动切换 Keycloak 的 `client_id`，区分测试和生产环境。
