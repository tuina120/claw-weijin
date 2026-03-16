# OpenClaw 多模型中文配置台

本项目是一个本地运行的网页工具，用来配置多个大模型接入信息。

## 功能

- 管理多个模型配置（新增、复制、删除、设为默认）
- 新增codex模型页（专注 API 地址 + API Key + 模型测试，支持“一键接入并设默认”）
- 支持常见厂商模板：OpenAI、Anthropic（Claude）、Gemini、DeepSeek、OpenRouter、Ollama、Azure OpenAI（微软）、自定义
- 实时生成统一 JSON 配置
- 支持一键拉取可用模型列表（根据当前厂商、接口地址、API 密钥）
- 支持模型关键字搜索与“只看常用模型”筛选
- 浏览器本地保存（`localStorage`）
- 导入和导出 JSON 文件
- 新增本地对话网页（可直接在浏览器中发起对话）
- 对话页支持“加入文件”并随消息发送给模型（文本类文件）
- 新增 NAS 风格文件浏览页（按扩展名分类树：`txt`/`run`/`yaml` 等、二维码下载、批量打包下载、图片/文本/PDF 在线预览）
- 支持生成两类外链：永久下载链接、一次性下载链接（下载一次即失效）
- 新增独立上传中心（拖拽上传 + 批量上传）
- 文件管理采用 SQLite 索引（`share/.openclaw/files.db`）+ 分层存储目录（`<ext>/YYYY/MM/分片/文件名`）
- 对话页支持“一键新建本地项目”（落盘到 `/home/weijin/codex/*`）
- 左侧常驻项目列表：每个项目独立对话历史，点击即可切换
- 支持 `/run <命令>` 自动执行本机任务（网页对话 + Telegram）
- 新增聊天软件桥接服务（Telegram、飞书）
- 新增聊天接入配置网页（仅 Telegram）
- 新增 SSH 工具页：集中保存 VPS 清单，支持多选批量执行 SSH 命令
- SSH 工具页支持按地区/环境分组筛选、预置运维命令面板、SFTP 上传下载、结果导出
- SSH 工具页支持读取本机默认公钥并批量分发到多台服务器，同时按地区/环境汇总执行结果
- SSH 工具页支持浏览当前 VPS 的远程目录与文件，点击目录进入，点击文件直接下载，并可把文件直接上传到当前目录

## 启动

```bash
cd /home/weijin/codex/openclaw
# 任选其一：
node server.js
# 或
npm start
# 或（如果已安装 systemd 用户服务）
systemctl --user restart openclaw-web.service
```

## Ubuntu 安装包（.deb）

如果你想把当前项目全部功能打成 Ubuntu 安装包，可直接执行：

```bash
cd /home/weijin/codex/openclaw
chmod +x scripts/build-ubuntu-deb.sh
./scripts/build-ubuntu-deb.sh
```

默认会在 `dist/` 目录生成类似：

```text
dist/openclaw_1.0.0_amd64.deb
```

安装：

```bash
sudo dpkg -i dist/openclaw_1.0.0_amd64.deb
```

说明：安装包默认不会包含你本机的 `bridge.config.json`（避免把 API Key 一起打包）。

安装后会自动创建并启动系统服务 `openclaw-web.service`，默认监听：

```text
http://127.0.0.1:4173
```

常用管理命令：

```bash
openclawctl status
openclawctl restart
openclawctl logs
openclawctl env
```

关键路径：

```text
程序目录: /opt/openclaw
环境变量: /etc/openclaw/openclaw.env
数据目录: /var/lib/openclaw
```

## 全功能网页版 IDE（code-server）

如果你要“接近 VS Code 桌面版”的完整 Web IDE（终端、扩展、调试、Git、工作区），可直接执行：

```bash
cd /home/weijin/codex/openclaw
./scripts/install-web-ide.sh
```

该脚本会自动设置中文界面（`zh-cn`）并强制开启左侧活动栏/状态栏，执行后会自动重启 Web IDE 服务。
并且服务每次启动前都会自动自检（中文语言包 + Codex 插件 + 兼容补丁），避免新建项目或重启后丢失插件。

默认地址：

```text
http://127.0.0.1:18080
```

管理命令：

```bash
systemctl --user status openclaw-web-ide.service
journalctl --user -u openclaw-web-ide.service -f
```

如果网页版 VS Code 出现“左侧活动栏/插件栏不显示”：

```bash
cd /home/weijin/codex/openclaw
./scripts/reset-web-ide-layout.sh
```

说明：脚本会备份并清理 code-server 的工作台布局缓存，然后重启 `openclaw-web-ide.service`。不会删除你的项目代码。

如果 Codex 插件已安装但图标仍不显示（或激活报错）：

```bash
cd /home/weijin/codex/openclaw
./scripts/fix-codex-extension.sh
```

说明：脚本会给本机 `openai.chatgpt` 扩展打兼容补丁，并把 Codex 视图固定到左侧活动栏，然后重启 Web IDE 服务。

新建项目也会自动生成：
- `.vscode/settings.json`（左侧栏可见、Codex 默认中文、启动即打开）
- `.vscode/extensions.json`（推荐安装 Codex 与中文语言包）

启动聊天软件桥接服务：

```bash
cd /home/weijin/codex/openclaw
cp bridge.config.example.json bridge.config.json
# 按需修改 bridge.config.json
npm run bridge
```

推荐用环境变量注入密钥（避免明文写入文件）：

```bash
export RC_KEY='你的RightCodesKey'
export TG_BOT_TOKEN='123456:telegram_bot_token'
npm run bridge
```

用户级 systemd 常驻（推荐）：

```bash
cd /home/weijin/codex/openclaw
./scripts/install-user-service.sh
```

说明：

- 脚本会生成 `~/.config/systemd/user/openclaw-bridge.service`。
- 脚本会生成 `~/.config/openclaw/bridge.env`（请填入 `RC_KEY/TG_BOT_TOKEN`）。
- 查看日志：`journalctl --user -u openclaw-bridge.service -f`
- 如果需要“退出登录后仍保持运行”：`sudo loginctl enable-linger $USER`
- 若日志里反复出现 `Telegram 轮询失败: fetch failed`，通常表示网络无法直连 `api.telegram.org:443`（或需要代理）。可在 `~/.config/openclaw/bridge.env` 配置 `HTTP_PROXY/HTTPS_PROXY/ALL_PROXY`，并设置 `BRIDGE_HTTP_TRANSPORT=curl`（或保持 `auto`）后执行 `systemctl --user restart openclaw-bridge.service`。

默认访问地址：

```text
http://localhost:4173
```

页面入口：

```text
配置台: http://localhost:4173/index.html
codex模型: http://localhost:4173/model-api.html
对话页: http://localhost:4173/chat.html
SSH工具: http://localhost:4173/ssh.html
接入配置区: http://localhost:4173/index.html#integrations-panel
旧接入页（自动跳转）: http://localhost:4173/integrations.html
文件管理: http://localhost:4173/files.html
上传中心: http://localhost:4173/uploads.html
公网文件管理入口: https://file.qxyx.net

SSH 主机配置文件：

```text
~/.config/openclaw/ssh-hosts.json
```

文件管理默认共享目录：

```text
/home/weijin/codex/share
```

文件分层存储示例：

```text
/home/weijin/codex/share/pdf/2026/03/ab/report.pdf
```

索引数据库位置：

```text
/home/weijin/codex/share/.openclaw/files.db
```

可选环境变量：

```text
OPENCLAW_SHARE_DIR=/home/weijin/codex/share
# 默认不限制单文件大小；如需限制再显式设置
OPENCLAW_FILES_UPLOAD_MAX_BYTES=0
# 文件外链签名有效期（秒），默认 30 天；设为 0 表示永不过期
OPENCLAW_FILES_SHARE_TTL_SEC=2592000
# 一次性链接默认有效期（秒），默认 7 天
OPENCLAW_FILES_SHARE_ONETIME_TTL_SEC=604800
# 可选：外链使用的公网域名（用于二维码/复制链接），例如 https://file.qxyx.net
OPENCLAW_FILES_PUBLIC_ORIGIN=https://file.qxyx.net
# 可选：固定签名密钥；不设置时会自动生成 ~/.config/openclaw/files-share-secret
OPENCLAW_FILES_SHARE_SECRET=replace-with-a-strong-secret
```

说明：若不设置 `OPENCLAW_FILES_PUBLIC_ORIGIN`，前端会使用当前访问域名生成分享链接。

## 微软登录（一次性密码/MFA）

OpenClaw 现在支持使用 Microsoft Entra ID（Azure AD）登录来保护所有页面与 API。你说的“一次性密码/验证码”由微软登录页触发（MFA），OpenClaw 只负责完成 OIDC 登录并用 Cookie 维持会话。

登录页：

```text
http://localhost:4173/login.html
```

说明：

- `login.html` 默认只显示“登录/扫码登录”，不再混入管理员配置说明。
- 管理员配置视图：在登录页加 `?admin=1` 打开，例如 `http://localhost:4173/login.html?admin=1`。

### 扫码登录（设备码）

如果你希望“用手机扫码完成登录”，可使用登录页里的“扫码登录”按钮。它使用 Microsoft 的 Device Code Flow：页面会生成二维码，你用手机扫码打开微软登录页完成认证后，桌面页面会自动拿到登录态。

注意：Device Code Flow 需要在 Entra 应用中启用 “Allow public client flows”：

- Entra 应用 -> `Authentication` -> `Allow public client flows` = `Yes`

配置文件（推荐）：

```text
~/.config/openclaw/ms.env
```

示例（可直接复制）：

```bash
cat > ~/.config/openclaw/ms.env <<'EOF'
MS_TENANT_ID=你的TenantId或common
MS_CLIENT_ID=你的ClientId
MS_CLIENT_SECRET=你的ClientSecret
MS_REDIRECT_URI=http://localhost:4173/auth/callback

# 可选：强制要求登录（默认：当 MS_TENANT_ID/MS_CLIENT_ID 配置齐全时自动开启）
OPENCLAW_REQUIRE_LOGIN=1
EOF

systemctl --user restart openclaw-web.service
```

注意：

- `MS_REDIRECT_URI` 必须与 Entra 后台“重定向 URI”完全一致；你用 `127.0.0.1` 访问就要登记 `http://127.0.0.1:4173/auth/callback`。
- 如果你暂时不想启用全站登录，可在环境变量里设置 `OPENCLAW_REQUIRE_LOGIN=0`。
- 如果你不想别人随意登录，建议启用白名单（只允许指定邮箱/域名/租户/oid）：
  - `OPENCLAW_ALLOWED_EMAILS=user1@company.com,user2@company.com`
  - `OPENCLAW_ALLOWED_DOMAINS=company.com`
  - `OPENCLAW_ALLOWED_TENANTS=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`
  - `OPENCLAW_ALLOWED_OIDS=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`

额外建议：

- 如果你只在本机使用，把服务监听改成 `127.0.0.1`（避免局域网其它人看到端口）：
  - 在 `openclaw-web.service` 里加环境变量 `HOST=127.0.0.1` 后重启服务。

## 访客体验（限时链接）

如果你想“偶尔给别人体验一下，但希望对方最后自己部署一台”，可以开启访客模式。

特点：

- 访客页面：`/guest.html`
- 需要管理员生成“限时一次性链接”（用一次就失效）
- 访客模式不落库、不执行命令、不提供终端/项目功能
- 访客需要填写自己的 API Key（OpenClaw 不会把 Key 保存到服务器）

开启方式（家里部署建议配合 Cloudflare Access）：

```bash
echo 'OPENCLAW_GUEST_ENABLED=1' >> ~/.config/openclaw/ms.env
systemctl --user restart openclaw-web.service
```

管理员生成体验链接（需要先登录到主站后带 Cookie 调用）：

```bash
curl -sS -X POST http://localhost:4173/api/guest/invite \
  -H 'Content-Type: application/json' \
  -d '{}' | jq
```

也可以打开管理员页面一键生成：

```text
http://localhost:4173/admin.html
```

如果你希望访客链接使用单独域名（更干净），可设置：

```text
OPENCLAW_GUEST_PUBLIC_ORIGIN=https://guest.qxyx.net
```

## Cloudflare Tunnel + Access（推荐公网访问）

适用场景：家里机器运行 OpenClaw，办公室用 `https://claw.qxyx.net` 访问，并且不希望别人随意登录。

建议架构：

- OpenClaw 只绑定本机：`HOST=127.0.0.1`
- Cloudflare Tunnel 将 `claw.qxyx.net` 转发到 `http://127.0.0.1:4173`
- Cloudflare Access 保护主站（只允许你的邮箱）
- 访客入口可单独做一个 Access Application（对 `/guest*` 或 `guest.qxyx.net` 设 Bypass），再由 OpenClaw 的“体验码”控制

本机安装 cloudflared（无需 root）：

```bash
cd /home/weijin/codex/openclaw
./scripts/install-cloudflared.sh
```

让 OpenClaw 只监听本机（推荐）：

```bash
cd /home/weijin/codex/openclaw
./scripts/bind-localhost.sh
```

创建 Tunnel（需要你在 Cloudflare 控制台授权一次）：

```bash
cloudflared tunnel login
# 建议用一个不会撞名的 tunnel 名称（例如 openclaw-home）
cloudflared tunnel create openclaw-home
cloudflared tunnel route dns openclaw-home claw.qxyx.net
cloudflared tunnel route dns openclaw-home guest.qxyx.net
cloudflared tunnel route dns openclaw-home file.qxyx.net
```

写入 cloudflared 配置并常驻（systemd 用户服务）：

```bash
cd /home/weijin/codex/openclaw
./scripts/install-cloudflared-service.sh
```

隧道性能建议（大文件上传/多人并发）：

- 协议建议固定为 `http2`（比不稳定的 UDP/QUIC 更稳，特别是家宽与代理环境）。
- `cloudflared` 可将压缩降为 `0`（二进制文件上传更省 CPU）：
  - `ExecStart` 增加 `--compression-quality 0`
- 并发可通过“多连接器副本”提升（同一 Tunnel 起 2 个 cloudflared 进程）：
  - 主服务：`openclaw-cloudflared.service`
  - 副本：`openclaw-cloudflared-b.service`
  - 启动：`systemctl --user enable --now openclaw-cloudflared-b.service`

当前推荐的 `~/.config/cloudflared/openclaw.yml` 关键项：

```yaml
protocol: http2
originRequest:
  connectTimeout: 15s
  tcpKeepAlive: 30s
  keepAliveConnections: 1024
  keepAliveTimeout: 5m
  noHappyEyeballs: true
```

Cloudflare Access（在 Cloudflare Zero Trust 控制台）建议做 2 个 Application：

1. 主站：`claw.qxyx.net`（Path: `/` 或 `/*`），Policy 只允许你的邮箱（例如 Email one-time pin 或任意你喜欢的 IdP）。
2. 访客：`claw.qxyx.net`（Path: `/guest*`）设为 Bypass，或单独用 `guest.qxyx.net` 并设 Bypass。

说明：

- 如果你把 OpenClaw 绑定到 `127.0.0.1`，外网无法直接连到本机端口，只能通过 Tunnel。

## 拉取模型列表

1. 在“配置编辑”里先填写提供商、接口地址、API 密钥。
2. 点击“拉取模型列表”。
3. 在“可用模型”下拉框里选择模型，会自动写入“模型 ID”。
4. 可选：使用“搜索模型”输入框按关键字筛选（如 `gpt`、`claude`）。
5. 可选：勾选“只看常用模型”快速过滤出常见模型。

说明：

- 这个拉取动作通过本地 `server.js` 代理请求上游接口，避免浏览器跨域问题。
- `Ollama` 默认支持无 API 密钥场景。

## 本地对话页

1. 打开 `http://localhost:4173/chat.html`。
2. 左侧可直接加载配置台中已保存的模型，也可手动填写参数。
3. 可在输入框上方点击“加入文件”附加文本类文件（txt/md/json/csv/js/py 等）。
4. 输入框上方新增“听写/朗读/停止”：
   - 听写：浏览器语音识别，把你说的话转成文字（不走模型，不消耗 token）。
   - 朗读：浏览器语音合成，朗读助手回复（不走模型，不消耗 token）。
   - 停止：停止当前朗读或听写。
5. 输入框上方新增“语音(语音开)”：
   - 开启后变成“按住说话”模式，松开会自动发送，并自动朗读助手回复（更像语音对话 App 的体验）。
6. 输入消息后点击“发送”（支持 `Ctrl+Enter` 快捷发送；也可仅发送附件）。
7. 自然语言任务会自动执行（例如“帮我查看当前目录并列出文件”）。
8. 也支持显式 `/run 命令`（例如 `/run ls -la`）。
9. 顶部“新建项目”可直接创建本地项目（支持空项目/Node.js/Python 模板）。
10. 输入框上方也有“新建项目”按钮，便于边聊边建。
11. 左侧常驻显示项目列表，可随时切换；每个项目独立显示对话。
12. 新建项目目录只允许在 `/home/weijin/codex/*` 范围内。
13. 聊天页不再显示“模型设置”表单；模型在输入框上方直接选择。
14. 项目“删除”是归档，不会删除磁盘项目；点击“展开归档项目”后可恢复。
15. 页面会保留你的对话历史和模型参数（浏览器本地保存）。

### 全局落库文件（自动）

所有项目与对话统一落库到：

- `/home/weijin/codex/workspace/SOUL.md`
- `/home/weijin/codex/workspace/USER.md`
- `/home/weijin/codex/workspace/MEMORY.md`
- `/home/weijin/codex/workspace/BOOTSTRAP.md`

说明：

- 首次创建项目或首次对话时会自动补齐这些文件。
- 所有项目的对话都会统一追加到全局 `MEMORY.md`，用于沉淀长期上下文。
- 发送对话时会自动读取上述全局文件并注入系统上下文，再叠加“当前项目路径”信息。
- 服务端会额外写入备份：`/home/weijin/codex/workspace/chat-history.json` 与 `.../backups/chat-history.jsonl`。
- 切换项目时会从服务端备份拉取历史，便于你换电脑后继续查看之前对话。
- 历史项目下若仍有 `项目目录/workspace`，将不再被读写（仅保留作历史数据）。
- 若“工作目录末级名”和“项目名”相同会被拦截，避免生成类似 `.../cf/cf` 的重复层级。

## 必读文件 / 启动序列（新增）

现在 OpenClaw 支持在每次对话前自动读取本地“必读文件”并注入到系统提示词（网页对话 + Telegram/飞书桥接都会生效）。

配置文件路径：

```text
~/.config/openclaw/startup-sequence.json
```

示例：

```json
{
  "enabled": true,
  "maxCharsPerFile": 6000,
  "maxTotalChars": 18000,
  "files": [
    "/home/weijin/codex/openclaw/README.md",
    "/home/weijin/codex/openclaw/your-startup.md"
  ]
}
```

说明：

- `enabled`: 是否启用。
- `files`: 绝对路径或相对 `openclaw` 项目目录的路径。
- `maxCharsPerFile`: 单文件最大注入字符数（超出会截断）。
- `maxTotalChars`: 本次请求总注入字符上限（超出会截断）。

可用接口（供后续网页配置页调用）：

- `GET /api/startup-sequence` 读取当前配置与加载预览
- `POST /api/startup-sequence` 保存配置

## 自动执行任务（/run）

执行开关配置文件：

```text
~/.config/openclaw/task-executor.json
```

示例：

```json
{
  "enabled": true,
  "naturalLanguageEnabled": true,
  "timeoutMs": 90000,
  "maxOutputChars": 16000,
  "workdir": "/home/weijin/codex/openclaw",
  "shell": "/bin/bash",
  "maxCommandLength": 2000
}
```

说明：

- 网页对话页：自然语言任务可自动执行；也支持 `/run 命令`。
- Telegram：自然语言任务同样可自动执行；也支持 `/run 命令`。
- 内置基础安全拦截（危险命令会拒绝执行）。
- 提供配置接口：`GET /api/task-executor`、`POST /api/task-executor`。

## 聊天软件绑定（Telegram / 飞书）

### 1) 准备桥接配置

编辑 `bridge.config.json`，最少要填：

- `model.provider`
- `model.baseUrl`
- `model.apiKey`
- `model.model`

示例（Right Codes）：

```json
{
  "model": {
    "provider": "openai",
    "baseUrl": "https://www.right.codes/codex/v1",
    "apiKey": "你的Key",
    "model": "gpt-5.2"
  }
}
```

### 2) 绑定 Telegram

1. 在 BotFather 创建机器人并拿到 `botToken`。
2. 在 `bridge.config.json` 设置（支持直接写 token，或用 `$TG_BOT_TOKEN` 环境变量）：

```json
{
  "telegram": {
    "enabled": true,
    "botToken": "123456:xxxx"
  }
}
```

3. 启动：`npm run bridge`。
4. 给机器人发消息测试（支持 `/help`、`/reset`、`/model`、`/chatid`、`/run 命令`）。

可选：用 `allowedChatIds` 限制只有指定会话能调用机器人。

### 3) 绑定飞书

1. 创建飞书自建应用，开通机器人和事件订阅能力。
2. 在 `bridge.config.json` 设置：

```json
{
  "feishu": {
    "enabled": true,
    "appId": "cli_xxx",
    "appSecret": "xxx",
    "verifyToken": "可选但建议填写",
    "port": 4174,
    "path": "/feishu/events"
  }
}
```

3. 将飞书事件回调 URL 指向：

```text
http://你的服务器地址:4174/feishu/events
```

4. 飞书事件订阅类型选择 `im.message.receive_v1`。
5. 建议先关闭事件加密（encrypt）；当前桥接未实现 decrypt。

可选：用 `allowedChatIds` 限制只有指定飞书会话能调用机器人。

### 4) 常见问题

- 网页配置台里的模型参数保存在浏览器 `localStorage`，桥接服务读不到这份数据。
- 桥接服务使用的是 `bridge.config.json`，需要手动同步模型参数。
- 若提示“上游接口错误（400）未配置模型”，通常是模型名或权限不匹配。
- 若提示 `model.apiKey 为空` 或 `telegram.botToken 为空`，请先 `export RC_KEY / TG_BOT_TOKEN`。
- 若 systemd 启动失败，请先执行：`systemctl --user daemon-reload` 后重试。

## 接入配置台（推荐）

打开：`http://localhost:4173/index.html#integrations-panel`

说明：`/integrations.html` 已并入统一配置台，访问旧地址会自动跳转到上面的合并入口。

可直接在网页里完成（仅 Telegram）：

- 读写 `bridge.config.json`
- 读写 `~/.config/openclaw/bridge.env`
- Telegram 连通性测试
- `openclaw-bridge.service` 启动、停止、重启、状态查看

## 配置格式

导出文件格式示例：

```json
{
  "version": 1,
  "generatedAt": "2026-03-08T13:55:00.000Z",
  "defaultModelId": "abc123",
  "models": [
    {
      "id": "abc123",
      "name": "主模型",
      "provider": "openai",
      "model": "gpt-4o-mini",
      "enabled": true,
      "api": {
        "baseUrl": "https://api.openai.com/v1",
        "apiKey": "sk-..."
      },
      "params": {
        "temperature": 0.7,
        "maxTokens": 1024,
        "topP": 1
      }
    }
  ]
}
```

## 安全提示

- API Key 保存在浏览器本地存储，请仅在你自己的设备上使用。
- 导出 JSON 会包含 API Key，注意妥善保管。
