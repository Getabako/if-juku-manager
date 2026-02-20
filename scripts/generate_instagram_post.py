#!/usr/bin/env python3
"""
Instagram投稿画像生成 - YouTubeサムネと同品質
gemini-3-pro-image-preview使用（YouTubeサムネと同じモデル）
"""

import base64
import os
import sys
import time
from pathlib import Path

from google import genai
from google.genai import types
from PIL import Image
import io

# 設定
PROJECT_ROOT = Path(__file__).parent.parent
CHARACTER_IMAGE = PROJECT_ROOT / "assets" / "character" / "翔太アバター.jpg"
OUTPUT_DIR = PROJECT_ROOT / "assets" / "generated"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

# API Key
API_KEY = None
env_file = PROJECT_ROOT / ".env"
if env_file.exists():
    for line in env_file.read_text().splitlines():
        if line.startswith("GEMINI_API_KEY="):
            API_KEY = line.split("=", 1)[1].strip()
            break
if not API_KEY:
    API_KEY = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_AI_API_KEY")

if not API_KEY:
    print("ERROR: GEMINI_API_KEY not found")
    sys.exit(1)

client = genai.Client(api_key=API_KEY)

# キャラクター画像読み込み
char_data = CHARACTER_IMAGE.read_bytes()
character_image = types.Part.from_bytes(data=char_data, mime_type="image/jpeg")

# YouTubeサムネと全く同じプロンプト構造でInstagram用に生成
BASE_PROMPT = """
Generate a square Instagram post image (1080x1080 pixels).

REQUIREMENTS:
1. CHARACTER (most important): Use the attached reference image as the character. 
   - Keep the character's distinctive features (face, hair, build) exactly as in the reference
   - Give them a PASSIONATE, ENERGETIC pose and expression — like they're excitedly teaching this topic
   - The character should take up about 40% of the image
   - Upper body focus, dynamic angle
   - MUST keep: black headband hiding eyes, spiky black hair, cyber tattoos on arms

2. TEXT (must be in Japanese, large and decorated):
   - Text must have: thick black outline (4px), drop shadow, glow effect
   - Use bold, impactful fonts — yellow or white text on contrasting background
   - Add decorative elements: stars, arrows, emphasis marks, speech bubbles
   - Text should feel like it's SHOUTING the topic — high energy, high contrast

3. BACKGROUND:
   - Vibrant, eye-catching gradient or themed background
   - High contrast so text and character pop
   - Can include subtle tech/topic-related icons or patterns

4. OVERALL VIBE:
   - Must look like a TOP Japanese YouTube education channel thumbnail
   - Maximum engagement — make viewers NEED to swipe
   - Reference style: popular Japanese tech/education YouTubers
   - Professional but energetic

Generate ONLY the image. No text response needed.
"""

slides = [
    {
        "filename": "insta_ai_consultation_1.png",
        "extra": """
SPECIFIC FOR THIS SLIDE:
- Character positioned on the RIGHT side, pointing excitedly at a laptop
- Main title text: "AI相談サイト" in HUGE yellow text with thick black outline at top
- Sub text: "1日で構築!" in HUGE white text with glow effect in center
- Background: Deep blue to purple gradient with subtle code/matrix patterns
- Decorative: sparkles, lightning bolts, energy effects around character
- Character is amazed/excited, mouth open wide
"""
    },
    {
        "filename": "insta_ai_consultation_2.png",
        "extra": """
SPECIFIC FOR THIS SLIDE:
- Character positioned on the RIGHT side, giving confident thumbs up
- Main text: "使った技術" in white at top
- Large text: "4つのAPI" in HUGE yellow with thick outline
- Show 4 floating tech cards/badges with glow: "Gemini AI", "Resend", "Sheets", "Vercel"
- Background: Very dark blue/black with neon blue grid and glow spots
- Character looks confident and knowledgeable
"""
    },
    {
        "filename": "insta_ai_consultation_3.png",
        "extra": """
SPECIFIC FOR THIS SLIDE:
- Character positioned on the LEFT side, looking amazed at a floating search UI
- Main text: "質問するだけ" in HUGE yellow at top with thick outline
- Sub text: "AIが即回答!" in HUGE white with neon glow
- Show a stylized Google-like search bar in the center-right
- Background: Dark blue to teal gradient with floating particles
- Streaming/typing effect suggested near search bar
"""
    },
    {
        "filename": "insta_ai_consultation_4.png",
        "extra": """
SPECIFIC FOR THIS SLIDE:
- Character CENTERED, in dynamic running/leaping forward pose, full of energy
- Main text: "作りたいなら" in white at top
- HUGE center text: "まず作れ!" in MASSIVE yellow with heavy outline and glow
- Small text at bottom: "AIが味方する時代" in white
- Background: Bright orange-yellow explosion of energy, radiating lines from character
- Maximum energy and excitement, sparkles and light effects everywhere
"""
    },
]

for i, slide in enumerate(slides):
    print(f"\n{'='*50}")
    print(f"画像 {i+1}/4 生成中: {slide['filename']}")
    print(f"{'='*50}")
    
    prompt = BASE_PROMPT + slide["extra"]
    
    contents = [
        prompt,
        "【参照キャラクター画像】このキャラクターを使用してください（目はヘアバンドで完全に隠れている点を厳守）:",
        character_image,
    ]
    
    for attempt in range(3):
        try:
            response = client.models.generate_content(
                model="gemini-3-pro-image-preview",
                contents=contents,
                config=types.GenerateContentConfig(
                    response_modalities=["image", "text"],
                    temperature=1.0,
                ),
            )
            
            # 画像抽出
            saved = False
            for part in response.candidates[0].content.parts:
                if part.inline_data and part.inline_data.data:
                    img = Image.open(io.BytesIO(part.inline_data.data))
                    # 1080x1080にリサイズ
                    img = img.resize((1080, 1080), Image.LANCZOS)
                    output_path = OUTPUT_DIR / slide["filename"]
                    img.save(str(output_path), "PNG", quality=95)
                    print(f"  ✅ 保存完了: {output_path}")
                    print(f"  サイズ: {img.size}")
                    saved = True
                    break
            
            if not saved:
                raise Exception("画像データが見つかりません")
            break
            
        except Exception as e:
            print(f"  ❌ 試行 {attempt+1}/3 失敗: {e}")
            if attempt < 2:
                print(f"  3秒待機中...")
                time.sleep(3)
    else:
        print(f"  ❌ 画像 {i+1} は3回とも失敗しました")
    
    # レートリミット対策
    if i < len(slides) - 1:
        time.sleep(2)

print(f"\n{'='*50}")
print("全画像生成完了！")
print(f"出力先: {OUTPUT_DIR}")
print(f"{'='*50}")
