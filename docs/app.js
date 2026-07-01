const state = {
  items: [],
  status: "all",
  region: "all",
  query: "",
};

const statusLabels = {
  "unreleased candidate": "未上市候选",
  "region-gap candidate": "地区服机会",
  "low-score review": "人工复核",
};

const regionLabels = {
  global: "全球",
  kr: "韩国",
  jp: "日本",
  cn: "中国大陆",
  sea: "东南亚",
  "tw-hk-mo": "港澳台",
};

const fallbackData = {
  generated_at: null,
  items: [],
};

async function loadData() {
  try {
    const response = await fetch("data/news.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    console.warn("Failed to load data/news.json", error);
    return fallbackData;
  }
}

function uniqueItems(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = item.id || item.link || item.title;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function inferActionsUrl() {
  const host = window.location.hostname;
  if (!host.endsWith(".github.io")) return null;
  const owner = host.replace(".github.io", "");
  const repo = window.location.pathname.split("/").filter(Boolean)[0] || `${owner}.github.io`;
  return `https://github.com/${owner}/${repo}/actions/workflows/daily-collect.yml`;
}

function bindManualCollectLink() {
  const link = document.getElementById("manualCollectLink");
  const actionsUrl = inferActionsUrl();
  if (!actionsUrl) {
    link.href = "https://github.com/";
    link.setAttribute("aria-disabled", "true");
    link.title = "部署到 GitHub Pages 后，这里会打开云端手动采集页面。";
    return;
  }
  link.href = actionsUrl;
  link.title = "打开 GitHub Actions，点击 Run workflow 手动采集昨天 00:00 到当前时间的资讯。";
}

function formatDate(value) {
  if (!value) return "未知时间";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "未知时间";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function normalize(value) {
  return String(value || "").toLocaleLowerCase();
}

function searchableText(item) {
  return normalize([
    item.title_zh,
    item.summary_zh,
    item.title,
    item.summary,
    item.status,
    item.source?.name,
    item.source?.language,
    ...(item.regions || []),
    ...Object.values(item.signals || {}).flat(),
  ].join(" "));
}

function filteredItems() {
  return state.items.filter((item) => {
    if (state.status !== "all" && item.status !== state.status) return false;
    if (state.region !== "all" && !(item.regions || []).includes(state.region)) return false;
    if (state.query && !searchableText(item).includes(state.query)) return false;
    return true;
  });
}

function updateSummary(items) {
  document.getElementById("itemCount").textContent = `${items.length} 条`;
  document.getElementById("highScoreCount").textContent = state.items.filter((item) => item.score >= 70).length;
  document.getElementById("regionGapCount").textContent = state.items.filter((item) => item.status === "region-gap candidate").length;
  document.getElementById("sourceCount").textContent = new Set(state.items.map((item) => item.source?.id).filter(Boolean)).size;
}

function statusClass(status) {
  if (status === "region-gap candidate") return "status region-gap";
  if (status === "low-score review") return "status low-score";
  return "status";
}

function renderChips(container, item) {
  container.replaceChildren();
  const chips = [
    ...(item.regions || []).map((region) => regionLabels[region] || region),
    ...(item.signals?.unreleased || []).slice(0, 3),
    ...(item.signals?.mobile || []).slice(0, 2),
  ];
  [...new Set(chips)].slice(0, 7).forEach((label) => {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.textContent = label;
    container.appendChild(chip);
  });
}

function render() {
  const list = document.getElementById("newsList");
  const empty = document.getElementById("emptyState");
  const template = document.getElementById("newsTemplate");
  const items = filteredItems();

  updateSummary(items);
  list.replaceChildren();
  empty.classList.toggle("hidden", items.length > 0);

  items.forEach((item) => {
    const node = template.content.cloneNode(true);
    const article = node.querySelector(".news-card");
    const score = node.querySelector(".score");
    const status = node.querySelector(".status");
    const link = node.querySelector("a");
    const summary = node.querySelector(".summary-text");
    const chips = node.querySelector(".chips");
    const source = node.querySelector(".source");
    const time = node.querySelector("time");

    article.dataset.id = item.id;
    score.textContent = `评分 ${item.score}`;
    status.className = statusClass(item.status);
    status.textContent = statusLabels[item.status] || item.status;
    link.href = item.link;
    link.textContent = item.title_zh || item.title;
    summary.textContent = item.summary_zh || item.summary || "暂无摘要，需要打开原文确认发行状态。";
    source.textContent = item.source?.name || "未知来源";
    time.textContent = formatDate(item.published_at);
    if (item.published_at) time.dateTime = item.published_at;
    renderChips(chips, item);

    list.appendChild(node);
  });
}

function bindEvents() {
  document.getElementById("searchInput").addEventListener("input", (event) => {
    state.query = normalize(event.target.value.trim());
    render();
  });

  document.getElementById("regionSelect").addEventListener("change", (event) => {
    state.region = event.target.value;
    render();
  });

  document.querySelectorAll("[data-status]").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll("[data-status]").forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
      state.status = button.dataset.status;
      render();
    });
  });
}

async function main() {
  const data = await loadData();
  state.items = Array.isArray(data.items) ? uniqueItems(data.items) : [];
  document.getElementById("generatedAt").textContent = data.generated_at ? `更新 ${formatDate(data.generated_at)}` : "等待采集";
  bindManualCollectLink();
  bindEvents();
  render();
}

main();
