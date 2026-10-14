# Deck embedding & pitfall register

Roivy fork lessons for building demo decks that embed generated artifacts, plus
the register of every trap hit while building them. Read this before touching
`tools/build_hero_deck.py`, page-entry effects, index grouping, or before
generating an encrypted share bundle.

## Deck 构建契约（当前架构）

三件套 + 两个固化脚本，全部在 `tools/`：

| 文件 | 职责 |
|---|---|
| `.hero_template.html` | 封面 + slide 骨架 + `<!--SCENES-->`/`<!--AUTOPLAY-->` 占位符 |
| `.autoplay.js` | 封面装饰构建 + 翻页动效引擎（postMessage 发送端 + `__deckProbe`） |
| `build_hero_deck.py` | 组装器：先向每个 demo 页**替换式**注入 `.deck-bridge.js`，再拼 deck |
| `regen_demo_pages.sh` | 模板/渲染器任何变更后必跑：重渲全部 demo 页 + 重建 deck |
| `verify_hero_deck.mjs` | CDP 真浏览器验证（封面 6 断言 + 每页 trace/index/分组，共 60） |

**组装器永远用模板文件 + `.replace()`**，禁止 Python `%` 格式化（CSS 的 `%`
和 emoji 代理对会炸）。构建产物里的 JS 必跑 `node --check`。桥注入必须
**先删旧 `<script data-rd="deck-bridge">` 块再注入**——marker 存在 ≠ 内容最新，
"已注入就跳过"会把旧版桥永远留在页面里。

## 页面进入动效（为什么必须是 postMessage 桥）

Chrome/Edge 对 `file://` 父页面访问 `iframe.contentDocument` 一律抛
`SecurityError`（file:// 的 origin 是 opaque "null"，即使是同目录）。
**通过 contentDocument 操控子页面的任何方案在真实浏览器里都是空转**——
这种错误最阴险的地方是代码不报错（try/catch 吞掉），页面看起来"正常"，
只有真浏览器探针才能揭穿。跨域发送消息永远允许，所以：

- 父（`.autoplay.js`）只做 `frame.contentWindow.postMessage({type:'rd-deck-fx'},'*')`
- 子（`.deck-bridge.js`）收到后**在自己文档内**重播 trace + 显示索引
- 就绪握手：子页 load 后回发 `rd-deck-ready`（**按 `event.source` 匹配 frame**，
  不要按 href 匹配——分享版 srcdoc iframe 没有 src 属性）
- 自动化验证走 `rd-deck-probe` → `rd-deck-state`（子页自报
  `getComputedStyle().animationName`、rail、分组标题）

第二个根因：**trace 动画只在 iframe load 时播一次，而 deck 的隐藏 slide
（display:none）里的 iframe 在打开瞬间就全部 load 完了**——动画在用户翻到
之前早已播完。必须钩住 deck 的 `window.render()`（包装函数），每次翻页对
活动页 iframe 重发 `rd-deck-fx`。

第三个根因：自研渲染器（roster/mindmap/fishbone）的节点和连线曾经**一个
`data-animate` 都不发射**——trace 的 CSS 选择器
`svg[data-animation="trace"] [data-animate="edge"]` 无可匹配元素。
**`grep -c data-animate` 会数到 viewer 模板内部的 19 edge/7 node 字符串**，
验证动画唯一可信的方法是断言 `animationName === 'rd-edge-flow'`。
渲染器用共享 `animateAttr(meta, kind, step)` 发射，且源 JSON 必须显式
`meta.animation: "trace"`（缺它则 data-animate 存在但 CSS 不触发）。

## Node index（底部索引）分组与显示

- 分组优先级：`data-node-outline-group` > `data-node-context` 最外段（按
  `' › '` 切）。roster=团队名、mindmap=一级分支、fishbone=6M 类目、
  workflow=泳道标签。
- **窄 iframe（<1024px，如左右分栏页）不满足 reader-layout 的桌面阈值，
  rail 不会自然出现**；且直设 `data-reader-rail` 会被 railPanel 的
  ResizeObserver → measure → clear 秒清（观察器战争打不赢）。正解：
  viewer 层的 `data-rd-force-rail`（measure/clear 都尊重它）。
- 桥里设置 force-rail 后要主动调 `Roivy.readerLayout.schedule()`，否则要等
  一次无关的 DOM 变化才会应用。

## Demo 页 staleness（最容易忘的坑）

`refresh_baselines.sh` 只重渲 `examples/`（两处）——**不刷 `.rd/demo/`**。
demo 页内嵌 viewer 模板，任何模板/渲染器字节变更后 demo 页就是旧版，
症状是"改了没生效/有的页好有的页坏"。定式：模板变更 → `generate:viewer`
→ `refresh_baselines.sh`（末尾已串 `regen_demo_pages.sh`）。

## 加密分享包（index_share.html）

`tools/build_share_deck.py` 产出单文件 `.rd/demo/index_share.html`：

- 10 个页面 HTML → gzip → 密钥流 XOR → base64，作为加密 payload 内嵌；
  运行时 loader 解密 → `DecompressionStream('gzip')` 解压 → 写入 iframe
  `srcdoc`（srcdoc 继承父 origin，postMessage 桥不变）。
- `crypto.subtle` 在 file:// 下不可用（非 secure context），所以用手写
  PRNG 密钥流；前端加密只能提高门槛，防不了决心破解者——如实告知用户。
- 防 AI 沉淀声明打包在内：`robots` noindex/noarchive/nosnippet、
  `noai`/`noimageai` 训练拒绝标签、显式禁止条款注释 + 封面可见一行授权说明。

## 踩坑登记（按域）

**file:// 与浏览器**
- `iframe.contentDocument` = SecurityError（见上，被 R8 记忆误记为"可访问"，证伪）
- `fetch`/XHR 读本地文件被 CORS 拦截 → 分享包只能内嵌，不能运行时加载
- `crypto.subtle` 仅 secure context → file:// 下不可用
- Edge 磁盘缓存旧版本地 HTML → 导航加 `?cb=Date.now()`；交付提示 Ctrl+F5
- 长会话大量 CDP 测试会耗尽浏览器管道（PipeCdp stream ended），taskkill
  后也可能不恢复 → 备选 `--headless=new --screenshot`

**动画与 viewer**
- 动画三条件缺一不可：源 `meta.animation:"trace"`、渲染器发射
  `data-animate`、html `data-ambient-motion="running"`；重播=删属性+强制
  reflow+重加
- `resolvedCrossovers` 是 crossover-halo 机制的信息性指标，
  `properCrossings=0` 才是缺陷数（复审报告把它当缺陷=没读源码）
- 动了 viewer/ 目录必须 `npm run generate:viewer`（模板是生成物）
- iframe 重载死循环：render() 里改 iframe.src → 每次翻页全量重载 → 崩溃；
  正确做法是纯 CSS display 切换
- `scrolling="no"` 会裁掉 viewer 底部 node finder/索引

**构建器与 JS**
- Python `%` 模板 × CSS `50%` = ValueError；emoji 代理对 `\ud83d\udcbe`
  UTF-8 写盘 surrogates not allowed → 用 HTML 实体
- `String.replace` 替换串里的 `$'`/`$&`/`$$` 是替换符 → 一律函数形式
- 对模板做文本手术极易切出语法错误且**静默死**（按钮全无响应无报错）→
  产物 JS 必跑 `node --check`；注入锚点选唯一顶层语句
- hero deck slide 无 id → 测试用 `findIndex` 按 classList 找

**编辑器（文件即数据库）**
- 拖拽中不做网格吸附（逐帧 round 产生 8px 跳变），松手才吸附
- 撤销快照在 pointerdown 采集（pointerup 时基线已被污染）
- 边定位优先 `data-edge-id`；按父节点重置的 key index 会跨节点撞号 →
  全局边计数器

**测试**
- `npm test` 是 `&&` 链：golden 挂了后面全部不跑（易误判全绿）
- 裸 `npm test` 不带 `RD_CHROME`——`desktopBrowser()` 已兜底 `findChrome()`
- 重复 finalize 同一路径报 evidence-path-conflict → 重跑前删目标目录
- 已知环境项（干净树同样失败，勿当回归）：path-semantics 2 个
  sameLocation Windows 用例、update-notifier 并发偶发

## 相关

- SKILL.md「Optional viewer capabilities」：动画/分组/强制 rail 的作者契约
- `docs/FORK-NOTES.md`：逐轮修改史（仓库内，不随包分发）
