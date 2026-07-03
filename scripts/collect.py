#!/usr/bin/env python3
"""Collect unreleased mobile-game news from RSS/Atom feeds."""

from __future__ import annotations

import argparse
import email.utils
import html
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SOURCES = ROOT / "data" / "sources.json"
DEFAULT_OUT = ROOT / "docs" / "data" / "news.json"
USER_AGENT = "NewMobileGameRadar/0.1 (+local research project)"
LOCAL_TZ = timezone(timedelta(hours=8))


MOBILE_TERMS = [
    "android",
    "ios",
    "iphone",
    "ipad",
    "app store",
    "google play",
    "mobile",
    "smartphone",
    "手游",
    "手机游戏",
    "手機遊戲",
    "手機",
    "移动游戏",
    "行動遊戲",
    "スマホ",
    "スマートフォン",
    "アプリ",
    "모바일",
    "휴대폰",
]

UNRELEASED_TERMS = [
    "pre-registration",
    "pre registration",
    "pre-register",
    "preregistration",
    "coming soon",
    "release date",
    "launch date",
    "announced",
    "opens beta",
    "closed beta",
    "open beta",
    "cbt",
    "obt",
    "beta test",
    "soft launch",
    "early access",
    "预约",
    "预注册",
    "預約",
    "預註冊",
    "事前登錄",
    "事前預約",
    "上市日期",
    "發行日期",
    "上線日期",
    "同步上線",
    "即將上線",
    "將於",
    "決定於",
    "預定",
    "預計",
    "公開",
    "發表",
    "事前登録",
    "配信日",
    "リリース日",
    "βテスト",
    "ベータ",
    "封测",
    "内测",
    "公测",
    "封閉測試",
    "刪檔測試",
    "不刪檔測試",
    "테스트",
    "사전예약",
    "출시 예정",
    "출시일",
]

STRONG_UNRELEASED_TERMS = [
    term
    for term in UNRELEASED_TERMS
    if term
    not in {
        "announced",
    }
]

REGION_GAP_TERMS = [
    "global",
    "worldwide",
    "international",
    "western",
    "sea",
    "southeast asia",
    "korea",
    "korean",
    "japan",
    "japanese",
    "china",
    "taiwan",
    "hong kong",
    "macau",
    "全球",
    "国际服",
    "國際版",
    "全球版",
    "海外",
    "韩服",
    "日服",
    "国服",
    "韓服",
    "日版",
    "台港澳",
    "港澳台",
    "グローバル",
    "韓国",
    "日本",
    "中国",
    "글로벌",
    "한국",
    "일본",
    "중국",
]

EXCLUDE_TERMS = [
    "available now",
    "patch notes",
    "update now available",
    "version update",
    "anniversary event",
    "collaboration event",
    "new content",
    "tie-in content",
    "limited-time event",
    "championship",
    "esports",
    "prize pool",
    "tier list",
    "guide",
    "tips",
    "攻略",
    "更新公告",
    "活動",
    "改版",
    "イベント",
    "アップデート",
    "가이드",
    "업데이트",
]

PC_CONSOLE_ONLY_TERMS = [
    "playstation",
    "ps5",
    "ps4",
    "xbox",
    "steam",
    "nintendo switch",
]

HARD_EXCLUDE_TERMS = [
    "championship",
    "esports",
    "prize pool",
    "tier list",
    "guide",
    "tips",
    "攻略",
    "가이드",
]


@dataclass
class FeedItem:
    source_id: str
    source_name: str
    source_language: str
    source_region: str
    source_weight: float
    title: str
    link: str
    summary: str
    published_at: str | None


def now_local() -> datetime:
    return datetime.now(LOCAL_TZ)


def clean_text(value: str | None) -> str:
    if not value:
        return ""
    value = re.sub(r"<[^>]+>", " ", value)
    value = html.unescape(value)
    return re.sub(r"\s+", " ", value).strip()


def parse_date(value: str | None) -> datetime | None:
    if not value:
        return None
    value = value.strip()
    try:
        parsed = email.utils.parsedate_to_datetime(value)
        if parsed:
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=timezone.utc)
            return parsed
    except (TypeError, ValueError):
        pass
    for fmt in ("%Y-%m-%dT%H:%M:%SZ", "%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%d %H:%M:%S"):
        try:
            parsed = datetime.strptime(value, fmt)
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=timezone.utc)
            return parsed
        except ValueError:
            pass
    return None


def iso_or_none(value: datetime | None) -> str | None:
    if not value:
        return None
    return value.astimezone(LOCAL_TZ).isoformat()


def contains_any(text: str, terms: list[str]) -> list[str]:
    folded = text.casefold()
    return [term for term in terms if term_matches(folded, term)]


def term_matches(folded_text: str, term: str) -> bool:
    folded_term = term.casefold()
    if any(ord(char) > 127 for char in folded_term):
        return folded_term in folded_text
    pattern = r"(?<![a-z0-9])" + re.escape(folded_term) + r"(?![a-z0-9])"
    return re.search(pattern, folded_text) is not None


def fetch_url(url: str, timeout: int = 20) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read()


def child_text(element: ET.Element, names: list[str]) -> str:
    for child in list(element):
        tag = child.tag.split("}", 1)[-1].lower()
        if tag in names:
            return child.text or ""
    return ""


def child_attr(element: ET.Element, child_name: str, attr_name: str) -> str:
    for child in list(element):
        tag = child.tag.split("}", 1)[-1].lower()
        if tag == child_name and child.attrib.get(attr_name):
            return child.attrib[attr_name]
    return ""


def parse_feed(xml_bytes: bytes, source: dict[str, Any]) -> list[FeedItem]:
    root = ET.fromstring(xml_bytes)
    root_name = root.tag.split("}", 1)[-1].lower()
    nodes: list[ET.Element]
    if root_name == "rss":
        channel = root.find("channel")
        nodes = list(channel.findall("item")) if channel is not None else []
    elif root_name == "rdf":
        nodes = [node for node in root.iter() if node.tag.split("}", 1)[-1].lower() == "item"]
    else:
        nodes = [node for node in root.iter() if node.tag.split("}", 1)[-1].lower() == "entry"]

    items = []
    for node in nodes:
        title = clean_text(child_text(node, ["title"]))
        link = clean_text(child_text(node, ["link"])) or child_attr(node, "link", "href")
        summary = clean_text(child_text(node, ["description", "summary", "content", "encoded"]))
        published_raw = child_text(node, ["pubdate", "published", "updated", "date", "dc:date"])
        published = parse_date(published_raw)
        if not title or not link:
            continue
        items.append(
            FeedItem(
                source_id=source["id"],
                source_name=source["name"],
                source_language=source.get("language", "unknown"),
                source_region=source.get("region_focus", "global"),
                source_weight=float(source.get("weight", 1.0)),
                title=title,
                link=link,
                summary=summary,
                published_at=iso_or_none(published),
            )
        )
    return items


def infer_regions(text: str, source_region: str) -> list[str]:
    mapping = {
        "global": ["global", "worldwide", "international", "全球", "国际服", "グローバル", "글로벌"],
        "kr": ["korea", "korean", "韩服", "韩国", "韓国", "한국"],
        "jp": ["japan", "japanese", "日服", "日本", "일본"],
        "cn": ["china", "chinese", "国服", "中国", "중국"],
        "sea": ["sea", "southeast asia", "东南亚", "東南アジア"],
        "tw-hk-mo": ["taiwan", "hong kong", "macau", "港澳台", "繁中"],
    }
    found = set()
    folded = text.casefold()
    for region, terms in mapping.items():
        if any(term_matches(folded, term) for term in terms):
            found.add(region)
    if source_region in {"kr", "jp", "cn", "sea", "tw-hk-mo"}:
        found.add(source_region)
    return sorted(found)


def classify(item: FeedItem) -> dict[str, Any] | None:
    text = f"{item.title} {item.summary}"
    mobile_hits = contains_any(text, MOBILE_TERMS)
    unreleased_hits = contains_any(text, UNRELEASED_TERMS)
    region_hits = contains_any(text, REGION_GAP_TERMS)
    exclude_hits = contains_any(text, EXCLUDE_TERMS)
    hard_exclude_hits = contains_any(text, HARD_EXCLUDE_TERMS)
    pc_hits = contains_any(text, PC_CONSOLE_ONLY_TERMS)
    strong_unreleased_hits = contains_any(text, STRONG_UNRELEASED_TERMS)

    score = 0.0
    reasons = []
    if mobile_hits:
        score += 35
        reasons.append("mobile platform")
    else:
        return None
    if unreleased_hits:
        score += 40
        reasons.append("unreleased signal")
    if region_hits:
        score += 15
        reasons.append("region signal")
    if item.source_region in ("global", "asia-global", "sea-global", "global-jp"):
        score += 5
    if pc_hits and not mobile_hits:
        score -= 30
        reasons.append("pc/console only risk")
    if exclude_hits:
        score -= 25
        reasons.append("update/event risk")
    if hard_exclude_hits and not strong_unreleased_hits:
        score -= 65
        reasons.append("hard editorial exclude")
    if not unreleased_hits:
        score -= 40
        reasons.append("missing unreleased signal")

    score *= item.source_weight
    regions = infer_regions(text, item.source_region)
    non_global_regions = [region for region in regions if region != "global"]
    is_region_gap = bool("global" in regions and non_global_regions) or len(non_global_regions) > 1
    status = "region-gap candidate" if is_region_gap else "unreleased candidate"
    if score < 45:
        return None

    return {
        "id": stable_id(item.link),
        "title": item.title,
        "link": item.link,
        "summary": item.summary,
        "source": {
            "id": item.source_id,
            "name": item.source_name,
            "language": item.source_language,
            "region_focus": item.source_region,
        },
        "published_at": item.published_at,
        "score": round(score, 1),
        "status": status,
        "regions": regions,
        "signals": {
            "mobile": mobile_hits[:6],
            "unreleased": unreleased_hits[:6],
            "region": region_hits[:6],
            "exclude": sorted(set(exclude_hits + hard_exclude_hits))[:6],
        },
        "review": {
            "needed": True,
            "notes": "Confirm platform, release state, and target regions before publishing.",
        },
    }


def stable_id(value: str) -> str:
    import hashlib

    return hashlib.sha1(value.encode("utf-8")).hexdigest()[:12]


def load_sources(path: Path) -> list[dict[str, Any]]:
    with path.open("r", encoding="utf-8") as handle:
        data = json.load(handle)
    return [source for source in data["sources"] if source.get("enabled", True)]


def is_chinese_source(source: dict[str, Any]) -> bool:
    return str(source.get("language", "")).casefold().startswith("zh")


def load_env_file(path: Path) -> None:
    if not path.exists():
        return
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


def keep_item(item: FeedItem, args: argparse.Namespace) -> bool:
    start, end = date_window(args)
    if start or end:
        if not item.published_at:
            return False
        published = datetime.fromisoformat(item.published_at)
        if start and published < start:
            return False
        if end and published >= end:
            return False
        return True
    return keep_recent(item, args.days)


def keep_recent(item: FeedItem, days: int) -> bool:
    if not item.published_at:
        return True
    published = datetime.fromisoformat(item.published_at)
    return published >= now_local() - timedelta(days=days)


def date_window(args: argparse.Namespace) -> tuple[datetime | None, datetime | None]:
    if args.since_yesterday:
        target = now_local().date() - timedelta(days=1)
        start = datetime.combine(target, datetime.min.time(), tzinfo=LOCAL_TZ)
        return start, now_local()
    if args.yesterday:
        target = now_local().date() - timedelta(days=1)
        start = datetime.combine(target, datetime.min.time(), tzinfo=LOCAL_TZ)
        return start, start + timedelta(days=1)
    if args.date:
        target = datetime.strptime(args.date, "%Y-%m-%d").date()
        start = datetime.combine(target, datetime.min.time(), tzinfo=LOCAL_TZ)
        return start, start + timedelta(days=1)
    return None, None


def collect(args: argparse.Namespace) -> dict[str, Any]:
    sources = load_sources(Path(args.sources))
    results: dict[str, dict[str, Any]] = {}
    errors = []

    for source in sources:
        if not args.include_non_chinese and not is_chinese_source(source):
            continue
        try:
            xml_bytes = fetch_url(source["url"], timeout=args.timeout)
            feed_items = parse_feed(xml_bytes, source)
        except (urllib.error.URLError, TimeoutError, ET.ParseError, ValueError) as exc:
            errors.append({"source": source["id"], "url": source["url"], "error": str(exc)})
            continue

        for feed_item in feed_items:
            if not keep_item(feed_item, args):
                continue
            classified = classify(feed_item)
            if classified is None and args.include_low_score:
                classified = low_score_item(feed_item)
            if classified:
                results[classified["id"]] = classified
        time.sleep(args.pause)

    items = merge_existing_items(Path(args.out), list(results.values()), args.retention_days, args.include_non_chinese)
    items = sorted(items, key=lambda row: (row.get("published_at") or "", row.get("score", 0)), reverse=True)
    if args.limit > 0:
        items = items[: args.limit]
    if args.translate:
        translate_items(items, args)
    start, end = date_window(args)

    return {
        "generated_at": now_local().isoformat(),
        "days": args.days,
        "retention_days": args.retention_days,
        "include_non_chinese": bool(args.include_non_chinese),
        "date_window": {
            "start": start.isoformat() if start else None,
            "end": end.isoformat() if end else None,
        },
        "translation": {
            "enabled": bool(args.translate),
            "target": args.translate_target,
            "provider": args.translation_provider if args.translate else None,
            "model": args.translation_model if args.translate and args.translation_provider == "openai" else None,
        },
        "count": len(items),
        "items": items,
        "errors": errors,
    }


def merge_existing_items(
    out_path: Path,
    new_items: list[dict[str, Any]],
    retention_days: int,
    include_non_chinese: bool,
) -> list[dict[str, Any]]:
    by_id = {}
    for item in load_existing_items(out_path):
        if not include_non_chinese and not item_is_chinese(item):
            continue
        by_id[item_key(item)] = item
    for item in new_items:
        if not include_non_chinese and not item_is_chinese(item):
            continue
        key = item_key(item)
        existing = by_id.get(key, {})
        by_id[key] = {**existing, **item}
    return prune_items(list(by_id.values()), retention_days)


def load_existing_items(out_path: Path) -> list[dict[str, Any]]:
    if not out_path.exists():
        return []
    try:
        with out_path.open("r", encoding="utf-8") as handle:
            data = json.load(handle)
    except (OSError, json.JSONDecodeError):
        return []
    items = data.get("items", [])
    return items if isinstance(items, list) else []


def item_key(item: dict[str, Any]) -> str:
    return str(item.get("id") or stable_id(str(item.get("link") or item.get("title") or "")))


def item_is_chinese(item: dict[str, Any]) -> bool:
    return str(item.get("source", {}).get("language", "")).casefold().startswith("zh")


def prune_items(items: list[dict[str, Any]], retention_days: int) -> list[dict[str, Any]]:
    if retention_days <= 0:
        return items
    cutoff = now_local() - timedelta(days=retention_days)
    kept = []
    for item in items:
        published_at = item.get("published_at")
        if not published_at:
            kept.append(item)
            continue
        try:
            published = datetime.fromisoformat(published_at)
        except ValueError:
            kept.append(item)
            continue
        if published >= cutoff:
            kept.append(item)
    return kept


def low_score_item(item: FeedItem) -> dict[str, Any]:
    return {
        "id": stable_id(item.link),
        "title": item.title,
        "link": item.link,
        "summary": item.summary,
        "source": {
            "id": item.source_id,
            "name": item.source_name,
            "language": item.source_language,
            "region_focus": item.source_region,
        },
        "published_at": item.published_at,
        "score": 0,
        "status": "low-score review",
        "regions": infer_regions(f"{item.title} {item.summary}", item.source_region),
        "signals": {"mobile": [], "unreleased": [], "region": [], "exclude": []},
        "review": {"needed": True, "notes": "Low-score item kept for manual review."},
    }


def translate_items(items: list[dict[str, Any]], args: argparse.Namespace) -> None:
    for item in items:
        language = item.get("source", {}).get("language", "")
        if language.startswith("zh"):
            item["title_zh"] = item["title"]
            item["summary_zh"] = item.get("summary", "")
            item["translation_status"] = "source_is_chinese"
            continue
        if args.translation_provider != "openai":
            item["translation_status"] = "unsupported_provider"
            continue
        api_key = os.environ.get("OPENAI_API_KEY")
        if not api_key:
            item["translation_status"] = "missing_openai_api_key"
            continue
        try:
            translated = translate_with_openai(
                title=item["title"],
                summary=item.get("summary", ""),
                api_key=api_key,
                model=args.translation_model,
                timeout=args.translation_timeout,
            )
        except (urllib.error.URLError, TimeoutError, ValueError, json.JSONDecodeError) as exc:
            item["translation_status"] = f"failed: {exc}"
            continue
        item["title_zh"] = translated.get("title_zh") or item["title"]
        item["summary_zh"] = translated.get("summary_zh") or item.get("summary", "")
        item["translation_status"] = "translated"


def translate_with_openai(title: str, summary: str, api_key: str, model: str, timeout: int) -> dict[str, str]:
    prompt = (
        "Translate the following mobile game news title and summary into natural Simplified Chinese. "
        "Keep game names, company names, platform names, and dates accurate. "
        "Return only JSON with keys title_zh and summary_zh.\n\n"
        f"Title: {title}\n"
        f"Summary: {summary}"
    )
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": "You are a precise game-news translator."},
            {"role": "user", "content": prompt},
        ],
        "temperature": 0.2,
        "response_format": {"type": "json_object"},
    }
    request = urllib.request.Request(
        "https://api.openai.com/v1/chat/completions",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "User-Agent": USER_AGENT,
        },
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        data = json.loads(response.read().decode("utf-8"))
    content = data["choices"][0]["message"]["content"]
    return json.loads(content)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Collect unreleased mobile-game news from RSS/Atom feeds.")
    parser.add_argument("--sources", default=str(DEFAULT_SOURCES), help="Path to sources JSON.")
    parser.add_argument("--out", default=str(DEFAULT_OUT), help="Output JSON path.")
    parser.add_argument("--days", type=int, default=30, help="Only keep items newer than this many days.")
    parser.add_argument("--date", help="Only keep items from this local date, formatted as YYYY-MM-DD.")
    parser.add_argument("--yesterday", action="store_true", help="Only keep items from yesterday in Asia/Shanghai time.")
    parser.add_argument("--since-yesterday", action="store_true", help="Keep items from yesterday 00:00 to now in Asia/Shanghai time.")
    parser.add_argument("--retention-days", type=int, default=7, help="Keep collected output items from the last N days. Use 0 to disable pruning.")
    parser.add_argument("--include-non-chinese", action="store_true", help="Allow non-Chinese sources. By default only zh-Hans / zh-Hant sources are collected.")
    parser.add_argument("--limit", type=int, default=120, help="Maximum items to write. Use 0 for no limit.")
    parser.add_argument("--timeout", type=int, default=20, help="HTTP timeout in seconds.")
    parser.add_argument("--pause", type=float, default=0.5, help="Pause between source requests.")
    parser.add_argument("--include-low-score", action="store_true", help="Keep every recent feed item for manual review.")
    parser.add_argument("--translate", action="store_true", help="Translate non-Chinese items into Simplified Chinese.")
    parser.add_argument("--translate-target", default="zh-Hans", help="Translation target language label.")
    parser.add_argument("--translation-provider", default="openai", choices=["openai"], help="Translation provider.")
    parser.add_argument("--translation-model", default=os.environ.get("OPENAI_TRANSLATION_MODEL", "gpt-4.1-mini"), help="OpenAI model for translation.")
    parser.add_argument("--translation-timeout", type=int, default=45, help="Translation request timeout in seconds.")
    return parser.parse_args()


def main() -> int:
    load_env_file(ROOT / ".env")
    args = parse_args()
    data = collect(args)
    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w", encoding="utf-8") as handle:
        json.dump(data, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
    print(f"Wrote {data['count']} items to {out_path}")
    if data["errors"]:
        print(f"{len(data['errors'])} source(s) failed; see output JSON for details.", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
