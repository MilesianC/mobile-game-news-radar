const state = {
  items: [],
  status: "all",
  region: "all",
  source: "all",
  query: "",
  sort: "latest",
  view: "cards",
  interested: {},
  sources: [],
};

const statusLabels = {
  "unreleased candidate": "未上市",
  "region-gap candidate": "地区差",
  "low-score review": "待复核",
};

const regionLabels = {
  global: "全球服",
  kr: "韩服",
  jp: "日服",
  cn: "国服",
  sea: "东南亚",
  "tw-hk-mo": "港澳台",
};

const fallbackData = { generated_at: null, items: [], sources: [] };
const manualCollectUrl = "https://github.com/MilesianC/mobile-game-news-radar/actions/workflows/daily-collect.yml";
const interestStorageKey = "mobile-game-radar.interested-games.v1";
const viewStorageKey = "mobile-game-radar.view.v1";

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
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalize(value) {
  return String(value || "").toLocaleLowerCase();
}

function safeStorageGet(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback));
  } catch (error) {
    console.warn(`Failed to load ${key}`, error);
    return fallback;
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
    regions: Array.isArray(item.regions) ? item.regions : [],
    image_url: item.image_url || "",
    news_link: item.link || "",
    source: item.source?.name || "未知来源",
    updated_at: item.published_at || "",
  };
}

function isInterested(item) {
  return Boolean(state.interested[gameKey(item)]);
}

function toggleInterested(item) {
  const info = gameInfo(item);
  if (state.interested[info.key]) delete state.interested[info.key];
  else state.interested[info.key] = info;
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
  link.href = inferActionsUrl();
  link.title = "打开 GitHub Actions，选择 Run workflow 采集昨天 0 点到现在的资讯";
}

function asDate(value) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
}

function formatDate(value) {
  const date = asDate(value);
  if (!date) return "时间待确认";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function dateKey(value) {
  const date = asDate(value) || new Date(0);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function dateGroupLabel(value) {
  const date = asDate(value);
  if (!date) return "日期待确认";
  const today = new Date();
  const startToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const startDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const days = Math.round((startToday - startDate) / 86400000);
  if (days === 0) return "今天";
  if (days === 1) return "昨天";
  return new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", weekday: "short" }).format(date);
}

function releaseTimestamp(value) {
  const text = String(value || "");
  const full = text.match(/(20\d{2})\D{0,3}(\d{1,2})\D{0,3}(\d{1,2})/);
  if (full) return new Date(Number(full[1]), Number(full[2]) - 1, Number(full[3])).getTime();
  const short = text.match(/(\d{1,2})月(\d{1,2})日/);
  if (short) {
    const now = new Date();
    let year = now.getFullYear();
    let result = new Date(year, Number(short[1]) - 1, Number(short[2])).getTime();
    if (result < now.getTime() - 15552000000) result = new Date(year + 1, Number(short[1]) - 1, Number(short[2])).getTime();
    return result;
  }
  return Number.MAX_SAFE_INTEGER;
}

function searchableText(item) {
  const game = item.game || {};
  return normalize([
    item.title_zh, item.summary_zh, item.title, item.summary, item.status,
    item.source?.name, game.name, game.release_time,
    ...(item.regions || []), ...(item.signals?.unreleased || []), ...(item.signals?.mobile || []),
  ].join(" "));
}

function filteredItems() {
  const items = state.items.filter((item) => {
    if (state.status !== "all" && item.status !== state.status) return false;
    if (state.region !== "all" && !(item.regions || []).includes(state.region)) return false;
    if (state.source !== "all" && item.source?.id !== state.source) return false;
    if (state.query && !searchableText(item).includes(state.query)) return false;
    return true;
  });

  return items.sort((a, b) => {
    if (state.sort === "score") return (b.score || 0) - (a.score || 0) || String(b.published_at).localeCompare(String(a.published_at));
    if (state.sort === "release") return releaseTimestamp(a.game?.release_time) - releaseTimestamp(b.game?.release_time);
    return String(b.published_at || "").localeCompare(String(a.published_at || ""));
  });
}

function createLink(url, label, className = "") {
  if (!url) return null;
  const link = document.createElement("a");
  link.href = url;
  link.target = "_blank";
  link.rel = "noreferrer";
  link.textContent = label;
  if (className) link.className = className;
  return link;
}

function setMedia(container, item) {
  const image = container.querySelector("img");
  const fallback = container.querySelector(".media-fallback");
  const name = gameInfo(item).name;
  container.href = item.link || "#";
  container.dataset.source = item.source?.id || "unknown";
  fallback.textContent = name.replace(/[《》「」『』\s]/g, "").slice(0, 2).toUpperCase() || "NEW";
  if (!item.image_url) {
    image.hidden = true;
    return;
  }
  image.src = item.image_url;
  image.alt = `${name} 新闻封面`;
  image.addEventListener("load", () => container.classList.add("has-image"), { once: true });
  image.addEventListener("error", () => {
    image.hidden = true;
    container.classList.remove("has-image");
  }, { once: true });
}

function renderServers(container, servers, regions = []) {
  container.replaceChildren();
  const prefix = document.createElement("span");
  prefix.textContent = "服务器 · ";
  container.appendChild(prefix);
  const values = servers.length ? servers : regions.map((region) => ({ name: regionLabels[region] || region, url: "" }));
  if (!values.length) {
    container.append("待确认");
    return;
  }
  values.slice(0, 4).forEach((server, index) => {
    if (index) container.append(" / ");
    const link = createLink(server.url, server.name || "未标明");
    container.appendChild(link || document.createTextNode(server.name || "未标明"));
  });
}

function renderSources() {
  const container = document.getElementById("sourceList");
  const select = document.getElementById("sourceSelect");
  const languageLabels = { "zh-Hans": "简中", "zh-Hant": "繁中", ja: "日文翻译" };
  container.replaceChildren();
  select.querySelectorAll("option:not(:first-child)").forEach((option) => option.remove());
  state.sources.forEach((source) => {
    const link = createLink(source.url, source.name);
    if (link) {
      const language = document.createElement("small");
      language.textContent = languageLabels[source.language] || source.language || "";
      link.appendChild(language);
      container.appendChild(link);
    }
    const option = document.createElement("option");
    option.value = source.id;
    option.textContent = source.name;
    select.appendChild(option);
  });
}

function renderOverview() {
  document.getElementById("itemCount").textContent = state.items.length;
  document.getElementById("datedCount").textContent = state.items.filter((item) => releaseTimestamp(item.game?.release_time) !== Number.MAX_SAFE_INTEGER).length;
  document.getElementById("interestCount").textContent = Object.keys(state.interested).length;
  document.getElementById("sourceCount").textContent = new Set(state.items.map((item) => item.source?.id).filter(Boolean)).size;
}

function focusCard(item, index) {
  const card = document.createElement("a");
  card.className = "focus-card";
  card.href = item.link || "#";
  card.target = "_blank";
  card.rel = "noreferrer";
  const image = document.createElement("img");
  image.loading = index ? "lazy" : "eager";
  image.alt = `${gameInfo(item).name} 新闻封面`;
  if (item.image_url) image.src = item.image_url;
  else image.hidden = true;
  image.addEventListener("error", () => { image.hidden = true; }, { once: true });
  const visual = document.createElement("span");
  visual.className = "focus-visual";
  visual.dataset.source = item.source?.id || "unknown";
  visual.appendChild(image);
  const rank = document.createElement("b");
  rank.textContent = String(index + 1).padStart(2, "0");
  visual.appendChild(rank);
  const body = document.createElement("span");
  body.className = "focus-body";
  const eyebrow = document.createElement("small");
  eyebrow.textContent = `${item.source?.name || "未知来源"} · ${statusLabels[item.status] || "新游"}`;
  const title = document.createElement("strong");
  title.textContent = gameInfo(item).name;
  const release = document.createElement("span");
  release.className = "focus-release";
  release.textContent = `发售 · ${item.game?.release_time || "待确认"}`;
  body.append(eyebrow, title, release);
  card.append(visual, body);
  return card;
}

function renderFocus() {
  const section = document.getElementById("focusSection");
  const rail = document.getElementById("focusRail");
  const picks = [...state.items]
    .sort((a, b) => (b.score || 0) - (a.score || 0) || String(b.published_at).localeCompare(String(a.published_at)))
    .slice(0, 4);
  section.classList.toggle("hidden", picks.length === 0);
  rail.replaceChildren(...picks.map(focusCard));
}

function renderInterested() {
  const list = document.getElementById("interestList");
  const empty = document.getElementById("interestEmpty");
  const clearButton = document.getElementById("clearInterestButton");
  const games = Object.values(state.interested).sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
  empty.classList.toggle("hidden", games.length > 0);
  clearButton.classList.toggle("hidden", games.length === 0);
  list.replaceChildren();

  games.forEach((game) => {
    const card = document.createElement("article");
    card.className = "interest-card";
    if (game.image_url) {
      const image = document.createElement("img");
      image.src = game.image_url;
      image.alt = "";
      image.loading = "lazy";
      image.addEventListener("error", () => image.remove(), { once: true });
      card.appendChild(image);
    }
    const body = document.createElement("div");
    const title = document.createElement("h3");
    title.textContent = game.name;
    const release = document.createElement("p");
    release.className = "interest-release";
    const releaseLabel = document.createElement("span");
    releaseLabel.textContent = "发售日期";
    const releaseValue = document.createElement("strong");
    releaseValue.textContent = game.release_time || "待确认";
    release.append(releaseLabel, releaseValue);
    const links = document.createElement("div");
    links.className = "interest-links";
    [createLink(game.news_link, "新闻"), createLink(game.official_site, "官网"), createLink(game.x_link, "X")].filter(Boolean).forEach((link) => links.appendChild(link));
    const servers = document.createElement("div");
    servers.className = "interest-servers";
    renderServers(servers, game.servers || [], game.regions || []);
    body.append(title, release, servers, links);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "remove-interest";
    remove.textContent = "取消";
    remove.addEventListener("click", () => {
      delete state.interested[game.key];
      saveInterested();
      render();
    });
    card.append(body, remove);
    list.appendChild(card);
  });
}

function renderChips(container, item) {
  const chips = [
    ...(item.regions || []).map((region) => regionLabels[region] || region),
    ...(item.signals?.unreleased || []).slice(0, 2),
    ...(item.signals?.mobile || []).slice(0, 1),
  ];
  container.replaceChildren();
  [...new Set(chips)].slice(0, 5).forEach((label) => {
    const chip = document.createElement("span");
    chip.textContent = label;
    container.appendChild(chip);
  });
}

function newsCard(item) {
  const node = document.getElementById("newsTemplate").content.cloneNode(true);
  const article = node.querySelector(".news-card");
  const media = node.querySelector(".news-media");
  const title = node.querySelector(".news-title");
  const originalTitle = node.querySelector(".original-title");
  const info = gameInfo(item);
  article.dataset.id = item.id || "";
  setMedia(media, item);
  media.querySelector(".media-source").textContent = item.source?.name || "未知来源";
  title.href = item.link || "#";
  title.textContent = item.title_zh || item.title || "未命名资讯";
  const hasOriginal = Boolean(item.title && item.title !== title.textContent);
  originalTitle.textContent = hasOriginal ? item.title : "";
  originalTitle.classList.toggle("hidden", !hasOriginal);
  node.querySelector(".summary-text").textContent = item.summary_zh || item.summary || "暂无摘要，请打开原文确认。";
  node.querySelector(".source").textContent = item.source?.name || "未知来源";
  const time = node.querySelector("time");
  time.textContent = formatDate(item.published_at);
  if (item.published_at) time.dateTime = item.published_at;
  const status = node.querySelector(".status");
  status.textContent = statusLabels[item.status] || item.status || "待判断";
  status.dataset.status = item.status || "unknown";
  node.querySelector(".score").textContent = `${item.score || 0} 分`;
  node.querySelector(".game-name").textContent = info.name;
  node.querySelector(".game-release strong").textContent = info.release_time || "待确认";
  renderServers(node.querySelector(".game-servers"), info.servers, info.regions);
  const official = createLink(info.official_site, "官网 ↗");
  const xLink = createLink(info.x_link, "X ↗");
  if (official) node.querySelector(".game-official").appendChild(official);
  if (xLink) node.querySelector(".game-x").appendChild(xLink);
  const button = node.querySelector(".interest-button");
  button.classList.toggle("active", isInterested(item));
  button.textContent = isInterested(item) ? "已关注" : "＋ 关注";
  button.addEventListener("click", () => toggleInterested(item));
  renderChips(node.querySelector(".chips"), item);
  return node;
}

function renderNews() {
  const list = document.getElementById("newsList");
  const empty = document.getElementById("emptyState");
  const items = filteredItems();
  document.getElementById("resultCount").textContent = `${items.length} 条`;
  list.dataset.view = state.view;
  list.replaceChildren();
  empty.classList.toggle("hidden", items.length > 0);

  const groups = new Map();
  items.forEach((item) => {
    const key = dateKey(item.published_at);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  });

  groups.forEach((groupItems) => {
    const section = document.createElement("section");
    section.className = "date-group";
    const heading = document.createElement("div");
    heading.className = "date-divider";
    const label = document.createElement("h3");
    label.textContent = dateGroupLabel(groupItems[0].published_at);
    const count = document.createElement("span");
    count.textContent = `${groupItems.length} 条`;
    heading.append(label, count);
    const grid = document.createElement("div");
    grid.className = "news-grid";
    groupItems.forEach((item) => grid.appendChild(newsCard(item)));
    section.append(heading, grid);
    list.appendChild(section);
  });
}

function renderViewButtons() {
  document.querySelectorAll("[data-view]").forEach((button) => button.classList.toggle("active", button.dataset.view === state.view));
}

function render() {
  renderOverview();
  renderInterested();
  renderViewButtons();
  renderNews();
}

function bindEvents() {
  document.getElementById("clearInterestButton").addEventListener("click", clearInterested);
  document.querySelectorAll(".main-nav a").forEach((link) => {
    link.addEventListener("click", () => {
      document.querySelectorAll(".main-nav a").forEach((item) => item.classList.remove("active"));
      link.classList.add("active");
    });
  });
  document.getElementById("searchInput").addEventListener("input", (event) => {
    state.query = normalize(event.target.value.trim());
    renderNews();
  });
  document.getElementById("sourceSelect").addEventListener("change", (event) => {
    state.source = event.target.value;
    renderNews();
  });
  document.getElementById("regionSelect").addEventListener("change", (event) => {
    state.region = event.target.value;
    renderNews();
  });
  document.getElementById("sortSelect").addEventListener("change", (event) => {
    state.sort = event.target.value;
    renderNews();
  });
  document.querySelectorAll("[data-status]").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll("[data-status]").forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
      state.status = button.dataset.status;
      renderNews();
    });
  });
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", () => {
      state.view = button.dataset.view;
      localStorage.setItem(viewStorageKey, JSON.stringify(state.view));
      renderViewButtons();
      renderNews();
    });
  });
}

async function main() {
  const data = await loadData();
  state.items = Array.isArray(data.items) ? uniqueItems(data.items) : [];
  state.interested = safeStorageGet(interestStorageKey, {});
  state.view = safeStorageGet(viewStorageKey, "cards");
  if (!['cards', 'list'].includes(state.view)) state.view = "cards";
  state.sources = Array.isArray(data.sources) ? data.sources : [];
  document.getElementById("generatedAt").textContent = data.generated_at ? `更新于 ${formatDate(data.generated_at)}` : "等待采集";
  bindManualCollectLink();
  renderSources();
  renderFocus();
  bindEvents();
  render();
}

main();
