/**
 * Remotion Root コンポーネント
 * すべての動画コンポジションを定義
 */
import React from 'react';
import { Composition } from 'remotion';
import { ReelVideo } from './ReelVideo';

export const RemotionRoot: React.FC = () => {
  return (
    <>
      {/* リール動画コンポジション（15秒版） */}
      <Composition
        id="ReelVideo"
        component={ReelVideo}
        durationInFrames={450} // 15秒 @ 30fps
        fps={30}
        width={1080}
        height={1920}
        defaultProps={{
          slides: [],
          backgroundImages: [],
          logoPath: '',
          thanksImagePath: '',
        }}
      />

      {/* リール動画コンポジション（30秒版） */}
      <Composition
        id="ReelVideoLong"
        component={ReelVideo}
        durationInFrames={900} // 30秒 @ 30fps
        fps={30}
        width={1080}
        height={1920}
        defaultProps={{
          slides: [],
          backgroundImages: [],
          logoPath: '',
          thanksImagePath: '',
        }}
      />
    </>
  );
};
