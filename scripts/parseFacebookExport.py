#!/usr/bin/env python3
"""
Facebook Export HTML を解析して NotebookLM 用 Markdown を生成
"""

import re
import json
from pathlib import Path
from datetime import datetime
from html import unescape

# パス設定
EXPORT_PATH = Path("/Users/takasaki19841121/Desktop/ifJukuManager/facebook-shotatakasaki37-2026_01_19-XwtXfVf2")
POSTS_HTML = EXPORT_PATH / "your_facebook_activity" / "posts" / "your_posts__check_ins__photos_and_videos_1.html"
OUTPUT_DIR = Path(__file__).parent.parent / "data" / "social"
JSON_OUTPUT = OUTPUT_DIR / "facebook_posts.json"
MD_OUTPUT = OUTPUT_DIR / "facebook_posts_for_notebooklm.md"


def clean_text(text):
    """HTMLタグを除去してテキストをクリーンアップ"""
    text = re.sub(r'<br\s*/?>', '\n', text)
    text = re.sub(r'<a[^>]*>([^<]*)</a>', r'\1', text)
    text = re.sub(r'<[^>]+>', '', text)
    text = unescape(text)
    text = re.sub(r'\n\s*\n', '\n\n', text)
    return text.strip()


def is_meaningful_text(text):
    """有用なテキストかどうか判定"""
    if not text or len(text) < 30:
        return False
    if 'に更新' in text and len(text) < 50:
        return False
    if text.startswith('http') and len(text) < 100:
        return False
    if '高崎 翔太さんが' in text:
        return False
    if text.startswith('場所:') and len(text) < 100:
        return False
    return True


def extract_date_for_text(html_content, text_start_pos):
    """テキストの位置から最も近い日付を取得"""
    # テキストの前にある最も近い日付を探す
    search_area = html_content[:text_start_pos]
    dates = re.findall(r'<div class="_a72d">([^<]+)</div>', search_area)
    if dates:
        return dates[-1]  # 最後に見つかった日付（最も近い）
    return None


def parse_posts():
    """HTMLファイルを解析して投稿を抽出"""
    print(f"📖 読み込み中: {POSTS_HTML}")

    with open(POSTS_HTML, "r", encoding="utf-8") as f:
        html_content = f.read()

    posts = []
    seen_texts = set()

    # 日本語を含むテキストブロックを抽出
    # ひらがな、カタカナ、漢字を含むdiv
    pattern = r'<div>([^<]*[ぁ-んァ-ン一-龥][^<]*(?:<br\s*/?>|<a[^>]*>[^<]*</a>)*[^<]*)</div>'

    for match in re.finditer(pattern, html_content, re.DOTALL):
        raw_text = match.group(1)
        text = clean_text(raw_text)

        if is_meaningful_text(text):
            # 重複チェック
            text_key = text[:80]
            if text_key not in seen_texts:
                seen_texts.add(text_key)

                # 日付を取得
                date = extract_date_for_text(html_content, match.start())

                posts.append({
                    "date": date,
                    "text": text,
                    "has_content": True
                })

    # 日付でソート（新しい順）
    def parse_date(date_str):
        if not date_str:
            return datetime.min
        try:
            # "1月 28, 2025 1:47:43 PM" 形式をパース
            months = {'1月': 1, '2月': 2, '3月': 3, '4月': 4, '5月': 5, '6月': 6,
                     '7月': 7, '8月': 8, '9月': 9, '10月': 10, '11月': 11, '12月': 12}
            for jp_month, num in months.items():
                if jp_month in date_str:
                    date_str = date_str.replace(jp_month, f"{num}月")
            match = re.match(r'(\d+)月\s*(\d+),\s*(\d+)', date_str)
            if match:
                m, d, y = match.groups()
                return datetime(int(y), int(m), int(d))
        except:
            pass
        return datetime.min

    posts.sort(key=lambda x: parse_date(x.get('date', '')), reverse=True)

    print(f"✅ {len(posts)} 件のテキスト投稿を抽出しました")
    return posts


def analyze_writing_style(posts):
    """文体を分析"""
    if not posts:
        return {"total_posts": 0}

    texts = [p["text"] for p in posts]
    all_text = " ".join(texts)

    # 絵文字抽出
    emoji_pattern = re.compile(
        "["
        "\U0001F300-\U0001F9FF"
        "\U00002600-\U000026FF"
        "\U00002700-\U000027BF"
        "✨👍🏻"
        "]+",
        flags=re.UNICODE
    )
    emojis = emoji_pattern.findall(all_text)
    emoji_count = {}
    for e in emojis:
        for char in e:
            emoji_count[char] = emoji_count.get(char, 0) + 1
    top_emojis = sorted(emoji_count.items(), key=lambda x: -x[1])[:10]

    # よく使う表現
    expressions = []
    exp_patterns = [
        ('w', 'w（笑い）'),
        ('！！', '！！（強調）'),
        ('〜', '〜（語尾伸ばし）'),
        ('よろしく', 'よろしく'),
        ('ライブ', 'ライブ配信'),
        ('AI', 'AI関連'),
    ]
    for pattern, desc in exp_patterns:
        count = all_text.count(pattern)
        if count >= 2:
            expressions.append(f"{desc}({count}回)")

    return {
        "total_posts": len(posts),
        "average_length": sum(len(t) for t in texts) // len(texts) if texts else 0,
        "max_length": max(len(t) for t in texts) if texts else 0,
        "top_emojis": [e[0] for e in top_emojis],
        "expressions": expressions,
    }


def save_results(posts):
    """結果を保存"""
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    style = analyze_writing_style(posts)

    # JSON保存
    archive = {
        "fetched_at": datetime.now().isoformat(),
        "user_name": "高崎翔太",
        "source": "Facebook Export",
        "total_posts": len(posts),
        "posts": posts,
        "writing_style": style,
    }

    with open(JSON_OUTPUT, "w", encoding="utf-8") as f:
        json.dump(archive, f, ensure_ascii=False, indent=2)
    print(f"📁 JSON保存: {JSON_OUTPUT}")

    # Markdown保存
    md_content = f"""# 高崎翔太のFacebook投稿アーカイブ

## 概要

このファイルには高崎翔太（if塾 塾頭）のFacebook投稿が含まれています。
これらの投稿を参考にして、高崎さんの文体・口調を真似たコンテンツを生成してください。

## 文体の特徴

- **投稿数**: {style.get('total_posts', 0)}件
- **平均文字数**: {style.get('average_length', 0)}文字
- **最大文字数**: {style.get('max_length', 0)}文字
- **よく使う絵文字**: {' '.join(style.get('top_emojis', []))}
- **よく使う表現**: {', '.join(style.get('expressions', []))}

## 高崎さんの文体のポイント

以下の特徴を真似てコンテンツを生成してください：

1. **カジュアルな口調**
   - 「〜でござんす」「〜なんだが」など独特の言い回し
   - 「w」を笑いとして使用
   - 「！！」で強調

2. **具体的でリアルタイム性**
   - 「今日は〜」「本日〜」で始まることが多い
   - 実際の体験をリアルタイムで共有

3. **ポジティブで行動的**
   - AIやテクノロジーへの積極的な姿勢
   - 教育への情熱
   - 子育てと仕事の両立

4. **専門性と親しみやすさの両立**
   - IT/AI関連の専門的な内容
   - でも難しくならず親しみやすい表現

---

## 投稿一覧

"""

    for i, post in enumerate(posts, 1):
        md_content += f"### {i}. {post.get('date', '日付不明')}\n\n"
        md_content += f"{post['text']}\n\n"
        md_content += "---\n\n"

    with open(MD_OUTPUT, "w", encoding="utf-8") as f:
        f.write(md_content)
    print(f"📁 Markdown保存: {MD_OUTPUT}")
    print(f"\n✅ NotebookLMには {MD_OUTPUT} をアップロードしてください")


def main():
    if not POSTS_HTML.exists():
        print(f"❌ ファイルが見つかりません: {POSTS_HTML}")
        return

    posts = parse_posts()

    if posts:
        print(f"\n📝 サンプル投稿:")
        for post in posts[:5]:
            print(f"\n  [{post.get('date', '?')}]")
            text = post['text'][:150] + "..." if len(post['text']) > 150 else post['text']
            print(f"  {text}")

        save_results(posts)
    else:
        print("❌ 投稿が見つかりませんでした")


if __name__ == "__main__":
    main()
