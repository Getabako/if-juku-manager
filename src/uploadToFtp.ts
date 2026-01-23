/**
 * 生成済み画像をFTPにアップロードするスクリプト
 */
import dotenv from 'dotenv';
dotenv.config();

import { createFtpUploader } from './lib/ftpUploader.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// コマンドライン引数からtopicIdを取得
const topicId = process.argv[2] || 'genspark_ai_1768996069305';
const imagesDir = path.join(__dirname, '../assets/generated', topicId);

const localPaths = [
  path.join(imagesDir, 'slide_1.jpg'),
  path.join(imagesDir, 'slide_2.jpg'),
  path.join(imagesDir, 'slide_3.jpg'),
  path.join(imagesDir, 'slide_4.jpg'),
];

async function upload() {
  console.log('FTPアップロードを開始...');
  console.log('トピックID:', topicId);
  console.log('アップロード対象:', localPaths);

  // dotenv読み込み後に新しいインスタンスを作成
  const uploader = createFtpUploader({});

  try {
    const urls = await uploader.uploadCarouselImages(localPaths, topicId);
    console.log('\n==============================');
    console.log('アップロード完了！');
    console.log('==============================');
    console.log('公開URL:');
    urls.forEach((url, i) => {
      console.log(`  ${i + 1}. ${url}`);
    });
  } catch (error) {
    console.error('アップロードエラー:', error);
    process.exit(1);
  }
}

upload();
