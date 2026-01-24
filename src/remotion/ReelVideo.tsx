/**
 * リール動画コンポーネント
 * スライド画像をアニメーション付きで表示
 * ロゴ画像、ズーム、文字アニメーション対応
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
  staticFile,
  Easing,
} from 'remotion';

interface Slide {
  type: string;
  headline: string;
  subtext?: string;
  points?: string[];
}

export interface ReelVideoProps {
  slides: Slide[];
  backgroundImages: string[];
  logoPath?: string;
  thanksImagePath?: string;
  bgmPath?: string;
}

// テキストスライドインアニメーション
const AnimatedText: React.FC<{
  text: string;
  delay?: number;
  style?: React.CSSProperties;
  animationType?: 'slideUp' | 'slideLeft' | 'fadeScale' | 'typewriter';
}> = ({ text, delay = 0, style, animationType = 'slideUp' }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const springConfig = {
    damping: 100,
    stiffness: 200,
    mass: 0.5,
  };

  const springValue = spring({
    frame: frame - delay,
    fps,
    config: springConfig,
  });

  let transform = '';
  let opacity = 1;

  switch (animationType) {
    case 'slideUp':
      opacity = interpolate(frame - delay, [0, 10], [0, 1], {
        extrapolateRight: 'clamp',
        extrapolateLeft: 'clamp',
      });
      const y = interpolate(springValue, [0, 1], [80, 0]);
      transform = `translateY(${y}px)`;
      break;

    case 'slideLeft':
      opacity = interpolate(frame - delay, [0, 10], [0, 1], {
        extrapolateRight: 'clamp',
        extrapolateLeft: 'clamp',
      });
      const x = interpolate(springValue, [0, 1], [100, 0]);
      transform = `translateX(${x}px)`;
      break;

    case 'fadeScale':
      opacity = interpolate(frame - delay, [0, 15], [0, 1], {
        extrapolateRight: 'clamp',
        extrapolateLeft: 'clamp',
      });
      const scale = interpolate(springValue, [0, 1], [0.8, 1]);
      transform = `scale(${scale})`;
      break;

    case 'typewriter':
      opacity = 1;
      break;
  }

  if (frame < delay) {
    opacity = 0;
  }

  return (
    <div
      style={{
        opacity,
        transform,
        ...style,
      }}
    >
      {text}
    </div>
  );
};

// ポイントリストアニメーション
const AnimatedPointList: React.FC<{
  points: string[];
  startDelay?: number;
}> = ({ points, startDelay = 20 }) => {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 28,
        width: '100%',
        padding: '0 40px',
      }}
    >
      {points.map((point, index) => (
        <AnimatedText
          key={index}
          text={`✓ ${point}`}
          delay={startDelay + index * 12}
          animationType="slideLeft"
          style={{
            fontSize: 44,
            fontWeight: 700,
            color: '#333',
            background: 'linear-gradient(135deg, rgba(255,255,255,0.98), rgba(255,245,235,0.95))',
            padding: '28px 40px',
            borderRadius: 24,
            boxShadow: '0 12px 40px rgba(0,0,0,0.25)',
            borderLeft: '6px solid #FF6B35',
            fontFamily: 'Noto Sans JP, sans-serif',
          }}
        />
      ))}
    </div>
  );
};

// 単一スライドコンポーネント（ズーム・パンアニメーション付き）
const SlideScene: React.FC<{
  slide: Slide;
  backgroundImage: string;
  logoPath?: string;
  isFirst: boolean;
  isLast: boolean;
}> = ({ slide, backgroundImage, logoPath, isFirst, isLast }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  // 複数のズームパターン
  const zoomPatterns = [
    { startScale: 1, endScale: 1.15, startX: 0, endX: -30 }, // ズームイン + 左へパン
    { startScale: 1.1, endScale: 1, startX: -20, endX: 0 }, // ズームアウト + 右へパン
    { startScale: 1, endScale: 1.12, startX: 0, endX: 20 }, // ズームイン + 右へパン
    { startScale: 1.08, endScale: 1.02, startX: 15, endX: -15 }, // ゆっくりズーム + 左右パン
  ];

  // ランダムなパターンを選択（フレームベースで決定論的に）
  const patternIndex = Math.floor((frame / 100) % zoomPatterns.length);
  const pattern = zoomPatterns[isFirst ? 0 : patternIndex];

  // ズームエフェクト（滑らか）
  const scale = interpolate(
    frame,
    [0, durationInFrames],
    [pattern.startScale, pattern.endScale],
    { extrapolateRight: 'clamp' }
  );

  // パンエフェクト
  const translateX = interpolate(
    frame,
    [0, durationInFrames],
    [pattern.startX, pattern.endX],
    { extrapolateRight: 'clamp' }
  );

  // フェードイン/アウト
  const opacity = interpolate(
    frame,
    [0, 20, durationInFrames - 15, durationInFrames],
    [0, 1, 1, isLast ? 1 : 0],
    { extrapolateRight: 'clamp' }
  );

  return (
    <AbsoluteFill style={{ opacity }}>
      {/* 背景画像（ズーム・パン付き） */}
      {backgroundImage && (
        <div
          style={{
            position: 'absolute',
            width: '120%',
            height: '120%',
            top: '-10%',
            left: '-10%',
            overflow: 'hidden',
          }}
        >
          <Img
            src={backgroundImage}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              transform: `scale(${scale}) translateX(${translateX}px)`,
            }}
          />
        </div>
      )}

      {/* グラデーションオーバーレイ */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: isFirst
            ? 'linear-gradient(135deg, rgba(255,0,128,0.6) 0%, rgba(128,0,255,0.5) 50%, rgba(0,128,255,0.4) 100%)'
            : 'linear-gradient(180deg, rgba(78,205,196,0.7) 0%, rgba(85,98,255,0.6) 50%, rgba(255,0,128,0.6) 100%)',
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
          animationType={isFirst ? 'fadeScale' : 'slideUp'}
          style={{
            fontSize: isFirst ? 100 : 76,
            fontWeight: 900,
            color: '#ffffff',
            textAlign: 'center',
            textShadow: `
              0 0 30px ${isFirst ? '#FF6B35' : '#4ECDC4'},
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
            lineHeight: 1.3,
          }}
        />

        {/* サブテキスト */}
        {slide.subtext && (
          <AnimatedText
            text={slide.subtext}
            delay={18}
            animationType="slideUp"
            style={{
              fontSize: 52,
              fontWeight: 700,
              color: '#FFE66D',
              textAlign: 'center',
              textShadow: '-3px -3px 0 #000, 3px -3px 0 #000, -3px 3px 0 #000, 3px 3px 0 #000',
              fontFamily: 'Noto Sans JP, sans-serif',
              marginBottom: 30,
            }}
          />
        )}

        {/* ポイントリスト */}
        {slide.points && slide.points.length > 0 && (
          <AnimatedPointList points={slide.points} startDelay={25} />
        )}
      </div>

      {/* ロゴ画像（右下） */}
      {logoPath && (
        <Img
          src={logoPath}
          style={{
            position: 'absolute',
            bottom: 60,
            right: 50,
            width: 140,
            height: 'auto',
            filter: 'drop-shadow(0 6px 15px rgba(0,0,0,0.5))',
          }}
        />
      )}
    </AbsoluteFill>
  );
};

// サンクス画像シーン（フェードイン、アニメーションなし）
const ThanksScene: React.FC<{
  thanksImagePath: string;
}> = ({ thanksImagePath }) => {
  const frame = useCurrentFrame();

  // フェードインのみ
  const opacity = interpolate(frame, [0, 30], [0, 1], {
    extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill style={{ opacity }}>
      <Img
        src={thanksImagePath}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
        }}
      />
    </AbsoluteFill>
  );
};

// メインリール動画コンポーネント
export const ReelVideo: React.FC<ReelVideoProps> = ({
  slides,
  backgroundImages,
  logoPath,
  thanksImagePath,
  bgmPath,
}) => {
  const { durationInFrames, fps } = useVideoConfig();

  // スライドがない場合のデフォルト
  if (slides.length === 0) {
    slides = [
      { type: 'cover', headline: 'if塾', subtext: 'AI×プログラミング教育' },
      { type: 'content', headline: '学べること', points: ['ChatGPT活用術', '画像生成AI', '業務自動化'] },
    ];
  }

  // サンクス画像用に最後の90フレーム（3秒）を確保
  const thanksFrames = thanksImagePath ? 90 : 0;
  const contentFrames = durationInFrames - thanksFrames;

  // 各スライドの表示時間を計算
  const framesPerSlide = Math.floor(contentFrames / slides.length);

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
            logoPath={logoPath}
            isFirst={index === 0}
            isLast={index === slides.length - 1 && !thanksImagePath}
          />
        </Sequence>
      ))}

      {/* サンクス画像（最後にフェードイン） */}
      {thanksImagePath && (
        <Sequence from={contentFrames} durationInFrames={thanksFrames}>
          <ThanksScene thanksImagePath={thanksImagePath} />
        </Sequence>
      )}
    </AbsoluteFill>
  );
};
