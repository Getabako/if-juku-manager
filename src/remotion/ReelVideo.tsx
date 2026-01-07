/**
 * リール動画コンポーネント
 * スライド画像をアニメーション付きで表示
 */
import React from 'react';
import {
  AbsoluteFill,
  Sequence,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  spring,
  Img,
  Audio,
} from 'remotion';

interface Slide {
  type: string;
  headline: string;
  subtext?: string;
  points?: string[];
}

interface ReelVideoProps {
  slides: Slide[];
  backgroundImages: string[];
  brandName: string;
  bgmPath?: string;
}

// テキストアニメーションコンポーネント
const AnimatedText: React.FC<{
  text: string;
  delay?: number;
  style?: React.CSSProperties;
}> = ({ text, delay = 0, style }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const opacity = interpolate(frame - delay, [0, 15], [0, 1], {
    extrapolateRight: 'clamp',
  });

  const translateY = spring({
    frame: frame - delay,
    fps,
    config: {
      damping: 200,
      stiffness: 100,
    },
  });

  const y = interpolate(translateY, [0, 1], [50, 0]);

  return (
    <div
      style={{
        opacity,
        transform: `translateY(${y}px)`,
        ...style,
      }}
    >
      {text}
    </div>
  );
};

// 単一スライドコンポーネント
const SlideScene: React.FC<{
  slide: Slide;
  backgroundImage: string;
  isFirst: boolean;
  isLast: boolean;
}> = ({ slide, backgroundImage, isFirst, isLast }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // ズームエフェクト
  const scale = interpolate(frame, [0, 90], [1, 1.1], {
    extrapolateRight: 'clamp',
  });

  // フェードイン/アウト
  const opacity = interpolate(
    frame,
    [0, 15, 75, 90],
    [0, 1, 1, isLast ? 1 : 0],
    { extrapolateRight: 'clamp' }
  );

  return (
    <AbsoluteFill style={{ opacity }}>
      {/* 背景画像 */}
      {backgroundImage && (
        <Img
          src={backgroundImage}
          style={{
            position: 'absolute',
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            transform: `scale(${scale})`,
          }}
        />
      )}

      {/* オーバーレイ */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: isFirst
            ? 'linear-gradient(135deg, rgba(0,0,0,0.4) 0%, rgba(0,0,0,0.6) 100%)'
            : 'linear-gradient(135deg, rgba(0,0,0,0.5) 0%, rgba(0,0,0,0.7) 100%)',
        }}
      />

      {/* コンテンツ */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          padding: 60,
        }}
      >
        {/* ヘッドライン */}
        <AnimatedText
          text={slide.headline}
          delay={5}
          style={{
            fontSize: isFirst ? 96 : 72,
            fontWeight: 900,
            color: '#ffffff',
            textAlign: 'center',
            textShadow: `
              -4px -4px 0 ${isFirst ? '#FF6B35' : '#4ECDC4'},
              4px -4px 0 ${isFirst ? '#FF6B35' : '#4ECDC4'},
              -4px 4px 0 ${isFirst ? '#FF6B35' : '#4ECDC4'},
              4px 4px 0 ${isFirst ? '#FF6B35' : '#4ECDC4'},
              -6px -6px 0 #000,
              6px -6px 0 #000,
              -6px 6px 0 #000,
              6px 6px 0 #000
            `,
            marginBottom: 40,
            fontFamily: 'Noto Sans JP, sans-serif',
          }}
        />

        {/* サブテキスト */}
        {slide.subtext && (
          <AnimatedText
            text={slide.subtext}
            delay={20}
            style={{
              fontSize: 48,
              fontWeight: 700,
              color: '#FFE66D',
              textAlign: 'center',
              textShadow: '-3px -3px 0 #000, 3px -3px 0 #000, -3px 3px 0 #000, 3px 3px 0 #000',
              fontFamily: 'Noto Sans JP, sans-serif',
            }}
          />
        )}

        {/* ポイントリスト */}
        {slide.points && slide.points.length > 0 && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 24,
              marginTop: 40,
              width: '100%',
            }}
          >
            {slide.points.map((point, index) => (
              <AnimatedText
                key={index}
                text={`✓ ${point}`}
                delay={30 + index * 10}
                style={{
                  fontSize: 42,
                  fontWeight: 700,
                  color: '#ffffff',
                  background: 'rgba(255,255,255,0.95)',
                  padding: '24px 36px',
                  borderRadius: 20,
                  color: '#333',
                  boxShadow: '0 8px 30px rgba(0,0,0,0.3)',
                  fontFamily: 'Noto Sans JP, sans-serif',
                }}
              />
            ))}
          </div>
        )}
      </div>

      {/* ブランドバッジ */}
      <div
        style={{
          position: 'absolute',
          bottom: 80,
          right: 60,
          background: 'linear-gradient(135deg, #FF6B35 0%, #F7931E 100%)',
          color: 'white',
          fontSize: 32,
          fontWeight: 900,
          padding: '16px 32px',
          borderRadius: 40,
          boxShadow: '0 8px 30px rgba(0,0,0,0.4)',
          fontFamily: 'Noto Sans JP, sans-serif',
        }}
      >
        if塾
      </div>
    </AbsoluteFill>
  );
};

// メインリール動画コンポーネント
export const ReelVideo: React.FC<ReelVideoProps> = ({
  slides,
  backgroundImages,
  brandName,
  bgmPath,
}) => {
  const { durationInFrames, fps } = useVideoConfig();

  // スライドがない場合のデフォルト
  if (slides.length === 0) {
    slides = [
      { type: 'cover', headline: 'if塾', subtext: 'AI×プログラミング教育' },
      { type: 'content', headline: '学べること', points: ['ChatGPT活用術', '画像生成AI', '業務自動化'] },
      { type: 'thanks', headline: 'フォローしてね！' },
    ];
  }

  // 各スライドの表示時間を計算
  const framesPerSlide = Math.floor(durationInFrames / slides.length);

  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      {/* BGM */}
      {bgmPath && <Audio src={bgmPath} volume={0.3} />}

      {/* スライドシーケンス */}
      {slides.map((slide, index) => (
        <Sequence
          key={index}
          from={index * framesPerSlide}
          durationInFrames={framesPerSlide}
        >
          <SlideScene
            slide={slide}
            backgroundImage={backgroundImages[index] || backgroundImages[0] || ''}
            isFirst={index === 0}
            isLast={index === slides.length - 1}
          />
        </Sequence>
      ))}

      {/* エンドスクリーン */}
      <Sequence from={durationInFrames - 30} durationInFrames={30}>
        <AbsoluteFill
          style={{
            background: 'linear-gradient(135deg, #FF6B35 0%, #F7931E 100%)',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'center',
          }}
        >
          <AnimatedText
            text={brandName}
            style={{
              fontSize: 120,
              fontWeight: 900,
              color: '#ffffff',
              textShadow: '0 8px 30px rgba(0,0,0,0.3)',
              fontFamily: 'Noto Sans JP, sans-serif',
            }}
          />
          <AnimatedText
            text="フォローで最新情報をGET!"
            delay={10}
            style={{
              fontSize: 48,
              fontWeight: 700,
              color: '#FFE66D',
              marginTop: 40,
              fontFamily: 'Noto Sans JP, sans-serif',
            }}
          />
        </AbsoluteFill>
      </Sequence>
    </AbsoluteFill>
  );
};
