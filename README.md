# 华东师大春日校园巡礼 · 实地寻宝

面向 **华东师范大学（闵行校区）** 的轻量 Web 互动：**校园地图导览 + 实地定位打卡 + 谜题收集碎片**。纯前端实现，无需后端，适合课堂展示、竞赛答辩或静态站点部署。

## 功能概览

- **隐私弹窗**：用户可选择授权定位，或进入「手动模式」任意点击地图点位浏览内容。
- **双模式点位**：
  - `guide`：导游讲解，展示图文与介绍文案。
  - `treasure`：寻宝点，答对谜题后计入碎片进度。
- **实地校验**：开启定位后，根据 [Haversine](https://en.wikipedia.org/wiki/Haversine_formula) 计算与点位的直线距离，在配置半径内才可解锁（否则提示距离）。
- **进度持久化**：碎片收集进度保存在浏览器 `localStorage`（键名：`ecnu_fragments`），集齐后可弹出通关界面并支持清空重来。
- **可选动效**：樱花飘落可一键开关。

## 技术栈

| 类别 | 说明 |
|------|------|
| 页面 | `index_v1.html` |
| 样式 | `style_v1.css` |
| 逻辑 | `app_v1.js`（原生 ES，无构建步骤） |
| 数据 | `config_v1.json`（地图校准、节点、谜题与资源路径） |

依赖：**现代浏览器** 的 `fetch`、`Geolocation API`、`localStorage`。部署在 **HTTPS** 下定位更稳定（及多数移动端要求）。

## 目录结构

```
├── index_v1.html      # 入口页面（请通过此文件打开站点根路径）
├── app_v1.js          # 交互与定位、抽屉、进度等逻辑
├── style_v1.css       # 样式
├── config_v1.json     # 内容与地图配置（改文案/坐标主要改这里）
├── README.md
└── assets/
    ├── images/        # 地图、校徽、各点位配图等
    └── ...
```

## 本地预览

因使用 `fetch('config_v1.json')`，**不要**直接用 `file://` 打开 HTML（可能被浏览器拦截跨域请求）。请在本目录启动任意静态文件服务，例如：

```bash
cd /path/to/本项目根目录
python3 -m http.server 8080
```

浏览器访问：`http://localhost:8080/index_v1.html`（或将 `index_v1.html` 重命名为 `index.html` 并访问根路径，按你的部署方式调整）。

## 上线部署（GitHub Pages 等）

1. 将整个项目推送到 GitHub 仓库。
2. 在仓库 **Settings → Pages** 中选择分支与目录（通常为 `/root` 或 `/docs`）。
3. 确保站点根目录能访问到 `config_v1.json` 与 `assets/`，且 HTML 中引用的路径与仓库结构一致。
4. **建议使用 HTTPS**，以便用户授权地理位置。

其他静态托管（Netlify、Vercel、云对象存储静态网站）同理：上传完整目录并指定入口为 `index_v1.html` 或重命名后的 `index.html`。

## 配置说明（`config_v1.json`）

| 字段 | 含义 |
|------|------|
| `project_config.map_calibration` | 校园地图图片左上角、右下角对应的 **真实经纬度**，用于把 `trigger_coords` 映射到地图上的百分比位置（若节点写了 `view_coords` 则优先用于展示）。 |
| `project_config.trigger_radius_meters` | 实地模式下，用户与点位触发坐标距离小于等于该值（米）才可解锁。 |
| `project_config.total_fragments_needed` | 通关所需碎片数；一般与 `treasure` 节点数量一致。 |
| `nodes[]` | 每个点位的 `type`、`name`、`view_coords`、`trigger_coords`、`assets`、`guide_messages` 或 `story_snippet` / `riddle_data`。 |

配图路径写在各节点的 `assets` 中；缺失时可使用仓库内已有的 `assets/images/placeholder_scene.svg` 作为占位。

## 开发者工具（可选）

- **坐标拾取器**：在 `index_v1.html` 与 `app_v1.js` 中标注为 `[DEV]` 的区块默认注释关闭，解开注释后可辅助调整 `view_coords`（详见代码内说明）。
- **控制台 `teleportTo('点位名称')`**：仅用于本地调试距离与解锁流程，**勿向最终用户宣传**；上线展示前可考虑删除或加环境判断。

## 隐私说明（面向用户与评审）

定位与距离计算均在用户浏览器内完成；本项目 **不** 内置向第三方服务器上传轨迹的代码。实际部署时请在隐私政策/弹窗文案中与你的托管商、域名备案情况保持一致。

## 许可证

若用于竞赛或课程提交，请按主办方要求补充署名与许可证；未指定时你可自行在仓库中添加 `LICENSE` 文件。
