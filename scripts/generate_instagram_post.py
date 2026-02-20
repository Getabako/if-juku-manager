#!/usr/bin/env python3
"""Instagram投稿画像生成 - 翔太の実績ベース"""

import base64
import os
import sys
from pathlib import Path
from google import genai
from google.genai import types
from PIL import Image
import io
import time

# 設定
PROJECT_ROOT = Path(__file__).parent.parent
CHARACTER_IMAGE = PROJECT_ROOT / "assets" / "character" / "翔太アバター.jpg"
OUTPUT_DIR = PROJECT_ROOT / "assets" / "generated"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

# API Key
API_KEY = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_AI_API_KEY")
if not API_KEY:
    env_file = PROJECT_ROOT / ".env"
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            if line.startswith("GEMINI_API_KEY="):
                API_KEY = line.split("=", 1)[1].strip()
                break

if not API_KEY:
    print("❌ GEMINI_API_KEY が見つかりません")
    sys.exit(1)

client = genai.Client(api_key=API_KEY)

# キャラクター画像読み込み
char_bytes = CHARACTER_IMAGE.read_bytes()

slides = [
    {
        "filename": "insta_ai_consultation_1.png",
        "prompt": """Generate a square Instagram post image (1080x1080 pixels).

THEME: "Built an AI Consultation Site in ONE DAY"
STYLE: Modern tech thumbnail, vibrant gradient background (deep blue to purple), cyber/tech aesthetic

CHARACTER (MANDATORY - use the attached reference image):
- The character from the reference image, in an excited/amazed pose
- Pointing at a laptop screen showing a website
- Character should be on the RIGHT side, taking about 40% of the image
- KEEP the black headband covering eyes, spiky black hair, cyber tattoos, red geta sandals

TEXT OVERLAY (large, bold, with black outline and drop shadow):
- Top: "AI相談サイト" (yellow, huge, with thick black border)
- Center: "1日で構築!" (white, very large, with glow effect)
- Keep text MINIMAL and LARGE - maximum readability

BACKGROUND: Dark blue-purple gradient with subtle code/matrix pattern, glowing particles

DO NOT include any other text. Keep it clean and impactful."""
    },
    {
        "filename": "insta_ai_consultation_2.png",
        "prompt": """Generate a square Instagram post image (1080x1080 pixels).

THEME: Tech stack used to build the AI consultation site
STYLE: Dark tech aesthetic with neon accents, modern infographic feel

CHARACTER (MANDATORY - use the attached reference image):
- The character giving a confident thumbs up
- Character on the RIGHT side, about 35% of image
- KEEP the black headband, spiky hair, cyber tattoos, red geta sandals

VISUAL ELEMENTS:
- 4 floating tech icons/cards arranged on the LEFT side:
  * A brain icon with "Gemini AI" text
  * An envelope icon with "Resend" text
  * A spreadsheet icon with "Sheets" text
  * A triangle icon with "Vercel" text
- Each card has a subtle glow effect
- Connected by thin neon lines

TEXT OVERLAY:
- Top: "使った技術" (white, large, with shadow)
- Bottom: "4 APIs" (yellow, huge, bold)

BACKGROUND: Very dark blue/black with subtle grid pattern and blue glow spots"""
    },
    {
        "filename": "insta_ai_consultation_3.png",
        "prompt": """Generate a square Instagram post image (1080x1080 pixels).

THEME: How the AI consultation site works - user asks, AI answers instantly
STYLE: Clean, modern UI showcase with tech aesthetic

CHARACTER (MANDATORY - use the attached reference image):
- Character looking amazed/impressed at a floating UI mockup
- Character on the LEFT side this time
- KEEP the black headband, spiky hair, cyber tattoos, red geta sandals

VISUAL ELEMENTS:
- A stylized search bar / chat interface floating in the center-right
- Streaming text effect (dots or lines suggesting AI is typing)
- A subtle glow around the interface

TEXT OVERLAY:
- Top: "質問するだけ" (yellow, large, bold with outline)
- Center: "AI即回答" (white, huge, with neon glow)

BACKGROUND: Gradient from dark blue to teal, with floating tech particles"""
    },
    {
        "filename": "insta_ai_consultation_4.png",
        "prompt": """Generate a square Instagram post image (1080x1080 pixels).

THEME: Call to action - "If you have an idea, just build it. AI is your ally."
STYLE: Inspirational, energetic, bright and hopeful

CHARACTER (MANDATORY - use the attached reference image):
- Character in a dynamic running/leaping pose, full of energy
- Holding laptop, moving toward the viewer
- Character CENTERED, taking about 50% of the image
- KEEP the black headband, spiky hair, cyber tattoos, red geta sandals

TEXT OVERLAY:
- Top: "作りたいなら" (white, large)
- Center: "まず作れ!" (yellow, HUGE, bold, with heavy outline and glow)
- Bottom small: "AIが味方する時代" (white, smaller)

BACKGROUND: Bright gradient (orange to yellow to light blue), explosion of energy lines and sparkles radiating from character, sunrise/dawn feeling"""
    }
]

for i, slide in enumerate(slides):
    print(f"\n画像 {i+1}/4 生成中: {slide['filename']}")

    for attempt in range(3):
        try:
            response = client.models.generate_content(
                model="gemini-2.0-flash-exp-image-generation",
                contents=[
                    slide["prompt"],
                    "【参照キャラクター画像】このキャラクターの外見を正確に再現してください:",
                    types.Part.from_bytes(data=char_bytes, mime_type="image/jpeg"),
                ],
                config=types.GenerateContentConfig(
                    response_modalities=["image", "text"],
                    temperature=1.0,
                ),
            )

            # 画像抽出
            found = False
            for part in response.candidates[0].content.parts:
                if part.inline_data and part.inline_data.data:
                    img = Image.open(io.BytesIO(part.inline_data.data))
                    img = img.resize((1080, 1080), Image.LANCZOS)
                    output_path = OUTPUT_DIR / slide["filename"]
                    img.save(str(output_path), "PNG", quality=95)
                    print(f"  ✅ 保存: {output_path}")
                    found = True
                    break
            if not found:
                raise Exception("画像データが見つかりません")
            break
        except Exception as e:
            print(f"  ❌ 試行 {attempt+1}/3 失敗: {e}")
            if attempt < 2:
                time.sleep(3)
    else:
        print(f"  ❌ 画像 {i+1} は3回とも失敗")

print("\n完了！")
