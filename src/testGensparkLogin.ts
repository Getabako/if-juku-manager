import { GensparkPlaywrightGenerator } from './lib/gensparkPlaywright.js';

async function testLogin() {
  console.log('Gensparkログインテスト開始...');

  const genspark = new GensparkPlaywrightGenerator();

  try {
    // ブラウザ表示モード（xvfb環境と同等）
    genspark.setHeadless(false);

    const success = await genspark.login();

    if (success) {
      console.log('✓ ログイン成功！');
      console.log('state.jsonが更新されました。');
      console.log('\n次のコマンドでGitHub Secretsを更新してください:');
      console.log('cat data/genspark_state.json | gzip | base64 | tr -d \'\\n\' | pbcopy');
    } else {
      console.log('✗ ログイン失敗');
    }
  } catch (error) {
    console.error('エラー:', error);
  } finally {
    await genspark.close();
  }
}

testLogin();
