# Get Microsoft Rewards（修复/增强版）

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-Tampermonkey%20%7C%20ScriptCat-green.svg)](https://www.tampermonkey.net/)

Microsoft Rewards 浏览器用户脚本：提供积分状态面板、签到、阅读、活动和搜索任务，并支持在打开 Rewards 仪表板后自动启动任务。

本项目基于 Muverix 的修复/增强版继续修改。本次新增了仪表板自动执行功能和 Chrome / Tampermonkey 安装、权限配置说明。自动执行修改已通过 JavaScript 语法检查，实际任务是否成功取决于登录状态、账号资格、地区和微软接口。

> 这是用户脚本，需要 Tampermonkey 等脚本管理器，不是独立 Chrome 扩展，也不需要部署服务器。自动化可能违反 Microsoft Rewards 使用规则，存在账号风控、封禁或积分清零风险，请自行评估。

## 功能

- **悬浮面板**：显示会员等级、积分、搜索进度、签到状态、阅读进度、活动统计和运行日志。
- **每日签到**：尝试通过微软 Rewards 移动端接口提交签到，需要有效授权。
- **阅读与活动**：尝试提交可用的阅读任务和活动；并非所有活动都受支持。
- **搜索任务**：使用热搜或内置关键词执行搜索，包含随机间隔和阶段性暂停；这些措施不保证规避风控。
- **一键执行**：按“签到 → 阅读 → 活动 → 搜索”的顺序运行。
- **新增：打开仪表板后自动执行**：初始化结束后等待 5 秒，满足登录和授权条件时自动展开面板并启动一键执行。

## 界面预览

<img width="350" alt="原版界面参考，实际界面以当前脚本为准" src="https://github.com/user-attachments/assets/76cdc4fc-535f-41ac-9ef9-f81218c06b4e" />

## 安装

### 1. 安装脚本管理器

推荐使用 Chrome + Tampermonkey。只需要安装一个脚本管理器，不要让多个管理器同时运行同一个脚本。

| 管理器 | 官网 | GitHub |
| --- | --- | --- |
| Tampermonkey | https://www.tampermonkey.net/ | https://github.com/Tampermonkey/tampermonkey |
| ScriptCat（脚本猫） | https://scriptcat.org/ | https://github.com/scriptscat/scriptcat |

请从官网进入对应浏览器的官方扩展商店安装。下文以 Chrome + Tampermonkey 为例；不同管理器的权限支持可能有差异。

### 2. 允许 Tampermonkey 执行用户脚本（重要）

**仅启用扩展和脚本，不代表 Chrome 已允许执行用户脚本。** 如果 Tampermonkey 顶部出现“请启用‘允许用户脚本’扩展设置”的蓝色提示，需要完成以下配置：

1. 在 Chrome 地址栏打开 `chrome://extensions/`。
2. 找到 **Tampermonkey**，点击 **详细信息**。
3. 找到并开启 **允许用户脚本（Allow user scripts）**。
4. 检查扩展的 **网站访问权限**，确保允许访问 Bing、Rewards 及微软登录页面。
5. 返回 Rewards 页面并刷新。

不同 Chrome / Tampermonkey 版本的入口可能不同。如果找不到“允许用户脚本”，可尝试在扩展管理页面开启右上角的 **开发者模式**，并点击 Tampermonkey 蓝色提示中的帮助链接，按照当前版本的指引操作。

### 3. 安装本项目脚本

**方式 A：GitHub Raw 安装**

打开本仓库的 [`get-microsoft-rewards.user.js`](get-microsoft-rewards.user.js)，点击 **Raw**。如果脚本管理器弹出安装页面，确认安装即可。

**方式 B：手动复制安装**

1. 打开 `get-microsoft-rewards.user.js` 并复制全部内容，包括最上方的 `// ==UserScript==` 元信息。
2. 进入 Tampermonkey 控制面板，选择“添加新脚本”。
3. 删除默认代码，粘贴本项目代码。
4. 按 **⌘S（Mac）或 Ctrl+S（Windows）** 保存，确认脚本开关已启用。
5. 打开或刷新 <https://rewards.bing.com/dashboard>。

> 修改本地项目文件不会自动更新 Tampermonkey 中已安装的脚本。后续修改后，需要重新复制保存或重新安装。当前脚本的元信息仍保留上游链接，请勿将上游安装入口当成本仓库最新版本的入口。

## 首次运行与授权

1. 使用自己的微软账号登录 <https://rewards.bing.com/dashboard>。
2. 正常注入后，页面右下角会出现礼物图标，点击展开 Microsoft Rewards 面板。
3. 查看面板日志，等待积分和授权数据初始化。
4. 如果出现“静默授权失败”，点击面板里的 **获取授权码**，在微软页面完成登录/授权。
5. 如果跳转到空白页面，复制地址栏里的完整 URL，粘贴到原 Rewards 面板的授权输入框，点击 **保存**。
6. 授权成功后，可点击 **签到** 单独测试，或点击 **一键全部执行**。

**不要向他人发送授权跳转 URL、授权码、Cookie、访问 Token 或刷新 Token，也不要将它们提交到 GitHub。** 脚本会通过脚本管理器存储刷新 Token，日志或截图分享前请检查是否含敏感信息。

## 配置：启动 Chrome 后自动运行

### 第一步：让 Chrome 启动时打开 Rewards

打开：

```text
chrome://settings/onStartup
```

选择 **打开特定网页或一组网页 → 添加新网页**，填入：

```text
https://rewards.bing.com/dashboard
```

这属于浏览器设置，脚本不会替你修改。它在启动 Chrome 时生效，不是每次新建标签页时生效。

**Mac 用户注意：** 关闭窗口不等于退出 Chrome。测试完整启动时，使用 **⌘Q** 退出 Chrome，再重新打开。

### 第二步：确认脚本自动执行配置

文件顶部 `CONFIG` 中已默认开启：

```js
autoRun: {
    enabled: true,
    delay: 5000
}
```

- `enabled: true`：开启自动执行；改成 `false` 即可关闭。
- `delay: 5000`：初始化结束后再等待 5000 毫秒（5 秒），不是从页面打开起固定 5 秒。

运行流程：

```text
启动 Chrome
  → 打开 Rewards dashboard
  → 初始化数据和授权状态
  → 等待 5 秒
  → 展开面板
  → 签到 → 阅读 → 活动 → 搜索
```

日志出现 **“🚀 一键执行开始”** 表示任务序列已经启动，不代表每项任务都成功。

### 自动执行的限制与防重复规则

- 仅在主机为 `rewards.bing.com`、路径以 `/dashboard` 开头时自动启动；其他 Bing 页面仍可手动执行。
- 缺少仪表板数据、缺少有效 Token 时，会跳过自动执行并提示先登录或授权；完成后请手动点击“一键全部执行”。
- 已有任务在运行或处于手动暂停状态时，不再次自动启动。
- 使用 `sessionStorage` 记录：**同一标签页当天自动启动一次后，刷新不再自动启动**。
- 标记表示“已启动”，并不表示“所有任务成功”；任务失败或中断后可以手动重试。
- 这是标签页级标记，不是整个浏览器的跨标签页锁。**不要同时打开多个 Rewards 标签页执行任务**。
- 浏览器恢复会话时可能恢复标记，因此重新启动 Chrome 不保证一定再次触发；必要时手动执行。
- 这是页面加载触发，不是每日定时任务。网页一直开着跨天，不会因此自动再次启动。
- 关闭或刷新执行中的页面会中断任务；浏览器后台节流、休眠或断网也可能影响任务。
- 一键执行会依次调用各模块，但不保证前一步失败就终止后续步骤。结果以微软服务端实际任务状态和积分为准。

## 常见问题

### 没有礼物图标 / 没有浮窗

依次检查：

1. Tampermonkey 及 Rewards 脚本开关是否都已启用。
2. Tampermonkey 是否提示开启 **允许用户脚本**；按上文开启后刷新。
3. 扩展是否有当前网站访问权限。
4. 脚本是否完整安装，包括 `@match`、`@grant` 等元信息。
5. 当前网址是否匹配以下范围：

   ```text
   https://www.bing.com/*
   https://cn.bing.com/*
   https://rewards.bing.com/*
   https://login.live.com/*
   ```

6. 打开开发者工具的 Console，刷新页面，检查与用户脚本相关的错误。

页面自身的 CSP 提示、`unload` 权限提示或头像请求 404，不一定是脚本故障原因。优先解决 Tampermonkey 明确给出的权限提示。

### 有浮窗但没有自动执行

- 确认打开的是 <https://rewards.bing.com/dashboard>，而不只是 Bing 首页。
- 确认已安装本仓库含 `autoRun` 配置的新版代码，且 `enabled` 为 `true`。
- 等待初始化完成并查看日志，必要时先完成登录/授权。
- 当前标签页今天已自动启动过时，不会重复启动，点击“一键全部执行”即可。

### 签到失败 / 显示未签到 / 积分没有增加

- 查看面板日志，检查授权是否有效。
- 部分任务取决于地区、账号资格、日期和服务端配置，并非所有账号都提供。
- 脚本依赖微软页面结构和接口，接口变化可能导致失效；伪装移动端请求不保证能完成移动端专属奖励。
- 搜索过程中包含本地预估进度，日志中的提交成功或预估加分，不代表微软一定发放积分。
- 任务刷新时间依地区而异，跨天后可能需要等待。不要通过高频重试解决服务端限制。

### 如何暂停或关闭自动执行？

- 执行过程中点击“一键全部执行”位置的暂停按钮；再次点击可继续。
- 将 `CONFIG.autoRun.enabled` 改为 `false` 并更新 Tampermonkey 中的代码，可关闭后续自动启动。
- 在脚本管理器中禁用本脚本，可停止后续页面加载时注入。

## 项目结构与检查

```text
README.md                       使用说明
LICENSE                         MIT 许可证
get-microsoft-rewards.user.js    用户脚本：配置、界面、授权和任务逻辑
```

不需要 npm 安装或构建。可在本地使用 Node.js 检查语法：

```bash
node --check get-microsoft-rewards.user.js
```

语法检查不能替代浏览器实测，也不能验证微软接口是否仍然可用。

## 隐私与权限

脚本会读取相关微软站点的 Cookie、执行跨域请求、存储授权与进度，并访问第三方热搜服务获取关键词。第三方热搜域名包括：

- `hot.baiwumm.com`
- `hotapi.nntool.cc`
- `cnxiaobai.com`

安装前请审查 `@grant`、`@connect` 和请求逻辑，只使用信任的代码来源。不要把个人登录数据放入仓库。

## 开源致谢

- 原始作品：[QingJ](https://github.com/QingJ01) 的 Get Microsoft Rewards。
- 修复/增强版上游：[Muverix/Get-Microsoft-Rewards](https://github.com/Muverix/Get-Microsoft-Rewards)，上游说明曾借助 Gemini AI 修复和重构。
- 逻辑参考：[liyan20001124-byte](https://github.com/liyan20001124-byte) 的“微软积分商城签到（全能智能重构版）”。
- 本次改动：增加 dashboard 页面自动启动任务，以及安装、权限、启动页和故障排查文档。

## 许可证与免责声明

本项目遵循 [MIT License](LICENSE)，请保留原有版权和许可声明。

本项目与微软无隶属或官方合作关系，仅供学习研究。使用前请阅读并遵守适用的 Microsoft Rewards 条款。自动化可能导致任务无效、账号受限、积分清零或封禁，作者及贡献者不对相关损失承担责任。
