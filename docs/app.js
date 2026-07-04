const state = {
  items: [],
  status: "all",
  region: "all",
  query: "",
  interested: {},
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

const manualCollectUrl = "https://github.com/MilesianC/mobile-game-news-radar/actions/workflows/daily-collect.yml";
const interestStorageKey = "mobile-game-radar.interested-games.v1";

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

function loadInterested() {
  try {
    return JSON.parse(localStorage.getItem(interestStorageKey) || "{}");
  } catch (error) {
    console.warn("Failed to load interested games", error);
    return {};
  }
}

function saveInterested() {
  localStorage.setItem(interestStorageKey, JSON.stringify(state.interested));
}

function gameKey(item) {
  const game = item.game || {};
  return game.name || item.title_zh || item.title || item.id;
}

function gameInfo(item) {
  const game = item.game || {};
  return {
    key: gameKey(item),
    name: game.name || item.title_zh || item.title || "未命名游戏",
    release_time: game.release_time || "",
    official_site: game.official_site || "",
    x_link: game.x_link || "",
    servers: Array.isArray(game.servers) ? game.servers : [],
    news_link: item.link,
    source: item.source?.name || "未知来源",
    updated_at: item.published_at || "",
  };
}

function isInterested(item) {
  return Boolean(state.interested[gameKey(item)]);
}

function toggleInterested(item) {
  const info = gameInfo(item);
  if (state.interested[info.key]) {
    delete state.interested[info.key];
  } else {
    state.interested[info.key] = info;
  }
  saveInterested();
  render();
}

function clearInterested() {
  state.interested = {};
  saveInterested();
  render();
}

function inferActionsUrl() {
  const host = window.location.hostname;
  if (!host.endsWith(".github.io")) return manualCollectUrl;
  const owner = host.replace(".github.io", "");
  const repo = window.location.pathname.split("/").filter(Boolean)[0] || `${owner}.github.io`;
  return `https://github.com/${owner}/${repo}/actions/workflows/daily-collect.yml`;
}

function bindManualCollectLink() {
  const link = document.getElementById("manualCollectLink");
  const actionsUrl = inferActionsUrl();
  link.href = actionsUrl;
  link.title = "打开 GitHub Actions，点击 Run workflow，默认选择 since_yesterday 采集昨天 0 点到现在的中文资讯。";
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

function createLinkOrText(url, label) {
  if (!url) {
    const span = document.createElement("span");
    span.className = "muted-value";
    span.textContent = "待补";
    return span;
  }
  const link = document.createElement("a");
  link.href = url;
  link.target = "_blank";
  link.rel = "noreferrer";
  link.textContent = label;
  return link;
}

function renderServers(container, servers, fallbackLink) {
  container.replaceChildren();
  if (!servers.length) {
    container.appendChild(createLinkOrText("", ""));
    return;
  }
  servers.forEach((server) => {
    const chip = document.createElement(server.url ? "a" : "span");
    chip.className = "server-chip";
    chip.textContent = server.name || "未标明";
    if (server.url) {
      chip.href = server.url;
      chip.target = "_blank";
      chip.rel = "noreferrer";
    } else if (fallbackLink) {
      chip.title = "暂未抓到服务器官网链接，可先打开新闻原文确认。";
    }
    container.appendChild(chip);
  });
}

function renderInterested() {
  const panel = document.getElementById("interestPanel");
  const list = document.getElementById("interestList");
  const games = Object.values(state.interested).sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
  panel.classList.toggle("hidden", games.length === 0);
  list.replaceChildren();

  games.forEach((game) => {
    const card = document.createElement("article");
    card.className = "interest-card";

    const title = document.createElement("h3");
    title.textContent = game.name;

    const meta = document.createElement("dl");
    meta.className = "interest-meta";
    [
      ["发售", game.release_time || "待补"],
      ["来源", game.source || "待补"],
    ].forEach(([term, value]) => {
      const row = document.createElement("div");
      const dt = document.createElement("dt");
      const dd = document.createElement("dd");
      dt.textContent = term;
      dd.textContent = value;
      row.append(dt, dd);
      meta.appendChild(row);
    });

    const links = document.createElement("div");
    links.className = "interest-links";
    links.append(
      createLinkOrText(game.news_link, "新闻"),
      createLinkOrText(game.official_site, "官网"),
      createLinkOrText(game.x_link, "X"),
    );

    const serverLinks = document.createElement("div");
    serverLinks.className = "interest-servers";
    renderServers(serverLinks, game.servers || [], game.news_link);

    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "取消";
    remove.addEventListener("click", () => {
      delete state.interested[game.key];
      saveInterested();
      render();
    });

    card.append(title, meta, links, serverLinks, remove);
    list.appendChild(card);
  });
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
  renderInterested();
  list.replaceChildren();
  empty.classList.toggle("hidden", items.length > 0);

  items.forEach((item) => {
    const node = template.content.cloneNode(true);
    const article = node.querySelector(".news-card");
    const score = node.querySelector(".score");
    const status = node.querySelector(".status");
    const link = node.querySelector("a");
    const summary = node.querySelector(".summary-text");
    const gameName = node.querySelector(".game-name");
    const gameRelease = node.querySelector(".game-release");
    const gameOfficial = node.querySelector(".game-official");
    const gameX = node.querySelector(".game-x");
    const gameServers = node.querySelector(".game-servers");
    const interestButton = node.querySelector(".interest-button");
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

    const info = gameInfo(item);
    gameName.textContent = info.name;
    gameRelease.textContent = info.release_time || "待补";
    gameOfficial.replaceChildren(createLinkOrText(info.official_site, "官网"));
    gameX.replaceChildren(createLinkOrText(info.x_link, "X"));
    renderServers(gameServers, info.servers, info.news_link);
    interestButton.classList.toggle("active", isInterested(item));
    interestButton.textContent = isInterested(item) ? "已感兴趣" : "感兴趣";
    interestButton.addEventListener("click", () => toggleInterested(item));

    source.textContent = item.source?.name || "未知来源";
    time.textContent = formatDate(item.published_at);
    if (item.published_at) time.dateTime = item.published_at;
    renderChips(chips, item);

    list.appendChild(node);
  });
}

function bindEvents() {
  document.getElementById("clearInterestButton").addEventListener("click", clearInterested);

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
  state.interested = loadInterested();
  document.getElementById("generatedAt").textContent = data.generated_at ? `更新 ${formatDate(data.generated_at)}` : "等待采集";
  bindManualCollectLink();
  bindEvents();
  render();
}

main();
