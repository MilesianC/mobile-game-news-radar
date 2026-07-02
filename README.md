# 新游资讯

一个面向“未上市手机游戏”的全球资讯采集项目。目标是从海外和中文游戏媒体、官方新闻源中发现仍有发行机会的新手游线索，包括：

- 全球尚未上市的 iOS / Android 游戏
- 已在韩国、日本、中国大陆、东南亚等地区上线，但国际服、欧美服或其他地区服尚未上线的游戏
- 处于预约、封测、软启动、事前登录、发行日公布、商店页面上线阶段的手游

## 快速开始

```powershell
python scripts/collect.py --days 30 --limit 120 --translate
python -m http.server 8000 -d docs
```

然后打开：

```text
http://127.0.0.1:8000
```

## 项目结构

```text
data/sources.json        新闻源配置
docs/index.html          资讯看板
docs/app.js              前端筛选和渲染逻辑
docs/styles.css          页面样式
docs/data/news.json      采集结果，前端默认读取这里
scripts/collect.py       RSS/Atom 采集和规则筛选脚本
.github/workflows/daily-collect.yml 云端每日采集任务
```

## 收录规则

系统会优先保留同时满足这些条件的资讯：

- 明确是手机平台：Android、iOS、Google Play、App Store、手游、スマホ、모바일 等
- 明确处于未完全上市阶段：pre-registration、CBT、OBT、beta、soft launch、coming soon、事前登録、封测、预约、上线日期公布等
- 或者存在地区发行差：例如韩服已上线、日服/国际服/全球服尚未上线

默认会排除：

- 仅 PC / 主机游戏
- 已经全球正式上线且没有新地区发行信息的游戏
- 单纯版本更新、活动、联动、补丁公告

## 常用命令

采集最近 14 天资讯：

```powershell
python scripts/collect.py --days 14 --translate
```

采集昨天 00:00 到 23:59 的资讯：

```powershell
python scripts/collect.py --yesterday --translate
```

采集昨天 00:00 到当前时间的资讯：

```powershell
python scripts/collect.py --since-yesterday --translate --retention-days 7
```

采集指定日期：

```powershell
python scripts/collect.py --date 2026-07-01 --translate
```

保留低分候选项，便于人工复核：

```powershell
python scripts/collect.py --include-low-score
```

输出到其他文件：

```powershell
python scripts/collect.py --out docs/data/news.json
```

## 自动采集

建议用 GitHub Actions，因为它在云端运行，不依赖你的电脑开机。项目里已经准备好 `.github/workflows/daily-collect.yml`，每天北京时间 07:00 自动运行：

```text
python scripts/collect.py --yesterday --translate --limit 120
```

使用步骤：

1. 把项目推到 GitHub 仓库。
2. 在仓库 Settings -> Secrets and variables -> Actions 里添加 `OPENAI_API_KEY`。
3. 到 Actions 页面手动运行一次 `Daily mobile game news`，选择 `since_yesterday`，确认能生成、提交 `docs/data/news.json` 并发布网页。

GitHub Actions 的 cron 使用 UTC 时间，配置里的 `0 23 * * *` 等于北京时间每天 07:00。GitHub 定时任务可能延迟启动，通常不是项目配置错误；需要严格准点时建议改用 VPS cron 或 Cloudflare Workers Cron。
页面里的“手动采集”按钮会打开这个 GitHub Actions 页面；点击 `Run workflow` 后会采集昨天 00:00 到当前时间的资讯。采集结果默认保留 7 天，采集器按新闻链接生成稳定 ID，同一篇新闻重复运行也不会重复写入。

## 中文翻译

巴哈姆特等中文来源会直接保留中文。英文、日文、韩文等来源需要设置 `OPENAI_API_KEY` 后才能自动翻译：

```powershell
python scripts/collect.py --yesterday --translate
```

在项目根目录创建 `.env`：

```text
OPENAI_API_KEY=你的 key
OPENAI_TRANSLATION_MODEL=gpt-4.1-mini
```

如果没有设置密钥，采集不会失败，但对应条目会标记为 `missing_openai_api_key`，页面会暂时显示原文。

## 让其他设备访问

局域网内临时查看：

```powershell
python -m http.server 8000 -d docs --bind 0.0.0.0
```

然后在同一 Wi-Fi 的手机或电脑打开：

```text
http://你的电脑局域网IP:8000
```

长期部署建议把 `docs/` 发布到静态托管，例如 GitHub Pages、Cloudflare Pages、Netlify、Vercel 或一台 NAS / VPS 的 Nginx。最省心的组合是 GitHub Actions 负责每天采集并提交 `docs/data/news.json`，同一个工作流直接发布 GitHub Pages。

## 人工复核建议

采集脚本会给每条资讯打标签和分数，但发行状态通常需要人工确认。建议人工复核这几项：

- `release_scope`：全球未上、地区服未上、软启动、封测等
- `platforms`：是否确认为 iOS / Android
- `regions`：已经上线和未上线的地区
- `official_links`：官网、商店页、预约页、社媒公告

后续可以把复核后的条目写入独立数据库或 Airtable / Notion / 飞书表格。
