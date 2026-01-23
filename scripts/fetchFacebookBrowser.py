#!/usr/bin/env python3
"""
Facebook投稿取得スクリプト（ブラウザ自動化版）

NotebookLM Skillと同じ方式で、ブラウザを自動操作して
Facebookの投稿を取得します。

使用方法:
  # 初回: 認証セットアップ（ブラウザでログイン）
  python scripts/fetchFacebookBrowser.py auth

  # 投稿取得
  python scripts/fetchFacebookBrowser.py fetch --url https://www.facebook.com/shota.takasaki.37

  # 投稿取得（スクロール回数指定）
  python scripts/fetchFacebookBrowser.py fetch --url https://www.facebook.com/shota.takasaki.37 --scrolls 20
"""

import argparse
import json
import os
import sys
import time
from datetime import datetime
from pathlib import Path

# Playwrightのインストール確認
try:
    from playwright.sync_api import sync_playwright
except ImportError:
    print("Installing playwright...")
    os.system(f"{sys.executable} -m pip install playwright")
    os.system(f"{sys.executable} -m playwright install chromium")
    from playwright.sync_api import sync_playwright

# パス設定
SCRIPT_DIR = Path(__file__).parent
DATA_DIR = SCRIPT_DIR.parent / "data" / "social"
AUTH_DIR = DATA_DIR / "facebook_auth"
STATE_FILE = AUTH_DIR / "state.json"
POSTS_FILE = DATA_DIR / "facebook_posts.json"
MD_FILE = DATA_DIR / "facebook_posts_for_notebooklm.md"


def setup_auth():
    """認証セットアップ - ブラウザを開いてログイン"""
    print("\n📱 Facebook認証セットアップ")
    print("=" * 50)
    print("ブラウザが開きます。Facebookにログインしてください。")
    print("ログイン完了後、このウィンドウに戻って Enter を押してください。")
    print("=" * 50 + "\n")

    AUTH_DIR.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)
        context = browser.new_context()
        page = context.new_page()

        page.goto("https://www.facebook.com/")

        input("\n✅ ログインが完了したら Enter を押してください...")

        # 認証状態を保存
        context.storage_state(path=str(STATE_FILE))
        print(f"\n✅ 認証情報を保存しました: {STATE_FILE}")

        browser.close()


def check_auth():
    """認証状態を確認"""
    if not STATE_FILE.exists():
        return False

    # ファイルが24時間以内に更新されているか確認
    mtime = STATE_FILE.stat().st_mtime
    age_hours = (time.time() - mtime) / 3600

    if age_hours > 24:
        print("⚠️ 認証情報が24時間以上前のものです。再認証をおすすめします。")

    return True


def fetch_posts(profile_url: str, max_scrolls: int = 10, show_browser: bool = False):
    """投稿を取得"""
    if not check_auth():
        print("❌ 認証されていません。先に 'auth' コマンドを実行してください。")
        return None

    print(f"\n📥 投稿を取得中: {profile_url}")
    print(f"   スクロール回数: {max_scrolls}")

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    posts = []

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=not show_browser)
        context = browser.new_context(storage_state=str(STATE_FILE))
        page = context.new_page()

        # プロフィールページに移動
        page.goto(profile_url)
        time.sleep(3)

        # ポップアップを閉じる（あれば）
        try:
            page.click('[aria-label="閉じる"]', timeout=2000)
        except:
            pass

        print("\n📜 スクロールして投稿を読み込み中...")

        for i in range(max_scrolls):
            # スクロール
            page.evaluate("window.scrollBy(0, 1000)")
            time.sleep(1.5)

            # 進捗表示
            print(f"   スクロール {i + 1}/{max_scrolls}", end="\r")

        print("\n\n📝 投稿を抽出中...")

        # 投稿を抽出（Facebookの構造に合わせて調整が必要な場合あり）
        post_elements = page.query_selector_all('[data-ad-preview="message"]')

        if not post_elements:
            # 代替セレクター
            post_elements = page.query_selector_all('div[dir="auto"][style*="text-align"]')

        if not post_elements:
            # さらに代替
            post_elements = page.query_selector_all('[data-ad-comet-preview="message"]')

        seen_texts = set()

        for elem in post_elements:
            try:
                text = elem.inner_text().strip()
                if text and len(text) > 10 and text not in seen_texts:
                    seen_texts.add(text)
                    posts.append({
                        "id": f"fb_{len(posts) + 1}",
                        "text": text,
                        "created_at": datetime.now().isoformat(),  # 実際の日付は取得困難
                    })
            except:
                continue

        # もし投稿が取得できない場合、ページ全体のテキストから抽出を試みる
        if not posts:
            print("   標準セレクターで取得できませんでした。ページ全体から抽出を試みます...")

            # 投稿らしきテキストブロックを探す
            all_divs = page.query_selector_all('div[dir="auto"]')
            for div in all_divs:
                try:
                    text = div.inner_text().strip()
                    # 投稿らしいもの（一定の長さがあり、UIテキストでない）
                    if (text and
                        len(text) > 50 and
                        len(text) < 5000 and
                        text not in seen_texts and
                        not text.startswith(('いいね', 'コメント', 'シェア', '友達', 'フォロー'))):
                        seen_texts.add(text)
                        posts.append({
                            "id": f"fb_{len(posts) + 1}",
                            "text": text,
                            "created_at": datetime.now().isoformat(),
                        })
                except:
                    continue

        browser.close()

    print(f"\n✅ {len(posts)} 件の投稿を取得しました")
    return posts


def analyze_writing_style(posts: list) -> dict:
    """文体を分析"""
    if not posts:
        return {}

    texts = [p["text"] for p in posts]
    all_text = " ".join(texts)

    # 絵文字抽出
    import re
    emoji_pattern = re.compile(
        "["
        "\U0001F300-\U0001F9FF"
        "\U00002600-\U000026FF"
        "\U00002700-\U000027BF"
        "]+",
        flags=re.UNICODE
    )
    emojis = emoji_pattern.findall(all_text)
    emoji_count = {}
    for e in emojis:
        for char in e:
            emoji_count[char] = emoji_count.get(char, 0) + 1

    top_emojis = sorted(emoji_count.items(), key=lambda x: -x[1])[:10]

    return {
        "total_posts": len(posts),
        "average_length": sum(len(t) for t in texts) // len(texts),
        "top_emojis": [e[0] for e in top_emojis],
    }


def save_posts(posts: list, profile_name: str = "高崎翔太"):
    """投稿を保存"""
    if not posts:
        print("保存する投稿がありません")
        return

    style = analyze_writing_style(posts)

    # JSON保存
    archive = {
        "fetched_at": datetime.now().isoformat(),
        "user_name": profile_name,
        "total_posts": len(posts),
        "posts": posts,
        "writing_style": style,
    }

    with open(POSTS_FILE, "w", encoding="utf-8") as f:
        json.dump(archive, f, ensure_ascii=False, indent=2)

    print(f"📁 JSON保存: {POSTS_FILE}")

    # Markdown保存（NotebookLM用）
    md_content = f"""# {profile_name}のFacebook投稿アーカイブ

## 文体分析

- **投稿数**: {style.get('total_posts', 0)}件
- **平均文字数**: {style.get('average_length', 0)}文字
- **よく使う絵文字**: {' '.join(style.get('top_emojis', []))}

---

## 投稿一覧

"""

    for i, post in enumerate(posts, 1):
        md_content += f"### {i}. 投稿\n\n"
        md_content += f"{post['text']}\n\n"
        md_content += "---\n\n"

    with open(MD_FILE, "w", encoding="utf-8") as f:
        f.write(md_content)

    print(f"📁 Markdown保存: {MD_FILE}")
    print(f"\n✅ NotebookLMには {MD_FILE} をアップロードしてください")


def main():
    parser = argparse.ArgumentParser(description="Facebook投稿取得（ブラウザ自動化）")
    subparsers = parser.add_subparsers(dest="command", help="コマンド")

    # auth コマンド
    subparsers.add_parser("auth", help="認証セットアップ")

    # fetch コマンド
    fetch_parser = subparsers.add_parser("fetch", help="投稿を取得")
    fetch_parser.add_argument("--url", required=True, help="プロフィールURL")
    fetch_parser.add_argument("--scrolls", type=int, default=10, help="スクロール回数")
    fetch_parser.add_argument("--show", action="store_true", help="ブラウザを表示")
    fetch_parser.add_argument("--name", default="高崎翔太", help="プロフィール名")

    # status コマンド
    subparsers.add_parser("status", help="認証状態を確認")

    args = parser.parse_args()

    if args.command == "auth":
        setup_auth()
    elif args.command == "fetch":
        posts = fetch_posts(args.url, args.scrolls, args.show)
        if posts:
            save_posts(posts, args.name)
    elif args.command == "status":
        if check_auth():
            print("✅ 認証済み")
        else:
            print("❌ 未認証。'auth' コマンドを実行してください。")
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
