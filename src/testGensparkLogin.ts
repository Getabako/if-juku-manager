import { GensparkPlaywrightGenerator } from './lib/gensparkPlaywright.js';

async function testLogin() {
  console.log('Gensparkログインテスト開始...');

  const genspark = new GensparkPlaywrightGenerator();

  try {
    // ヘッドレスモードON（GitHub Actionsと同じ環境）
    genspark.setHeadless(true);

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
