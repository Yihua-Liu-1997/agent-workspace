#!/usr/bin/env node
/**
 * 简化测试：测试 spawn agent 和 push 功能
 */

const fs = require('fs');
const { execSync } = require('child_process');

// 测试数据
const TEST_PAPERS = [
  {
    arxiv_id: '2403.09513',
    title: 'Test Paper - Deep Learning Applications',
    likes: 10,
    views: 1000
  }
];

const TODAY = new Date().toISOString().slice(0, 10);
const REVIEW_DIR = `/home/useradmin/agent_workspace/data/paper-reviews/${TODAY}`;

/**
 * 测试 spawn agent
 */
async function testSpawnAgent(paper) {
  console.log(`\n🚀 测试 spawn agent for ${paper.arxiv_id}...`);
  
  // 创建目录
  if (!fs.existsSync(REVIEW_DIR)) {
    fs.mkdirSync(REVIEW_DIR, { recursive: true });
    console.log(`📁 创建目录: ${REVIEW_DIR}`);
  }
  
  const label = `测试-${paper.arxiv_id}`;
  const reviewPath = `${REVIEW_DIR}/${paper.arxiv_id}.md`;
  const task = `测试任务：读取 arXiv 论文 HTML 版本 https://arxiv.org/html/${paper.arxiv_id}，写一个简短摘要（100-200字），保存到 ${reviewPath}`;
  
  try {
    const cmd = `hermes chat -q "${task.replace(/"/g, '\\"')}"`;
    
    console.log('📤 执行命令...');
    const result = execSync(cmd, {
      encoding: 'utf-8',
      timeout: 130000,
      maxBuffer: 10 * 1024 * 1024
    });
    
    console.log('✅ Agent 完成');
    console.log('输出片段:', result.substring(0, 200) + '...');
    
    // 检查文件
    if (fs.existsSync(reviewPath)) {
      const stats = fs.statSync(reviewPath);
      console.log(`✅ 长文已生成: ${(stats.size / 1024).toFixed(1)} KB`);
      
      const content = fs.readFileSync(reviewPath, 'utf-8');
      console.log('内容片段:', content.substring(0, 300) + '...');
      
      return { success: true, path: reviewPath };
    } else {
      console.log('⚠️  文件未生成');
      return { success: false };
    }
    
  } catch (error) {
    console.error('❌ 执行失败:', error.message);
    
    // 检查是否是超时但文件已生成
    if (fs.existsSync(reviewPath)) {
      const stats = fs.statSync(reviewPath);
      console.log(`✅ 虽然超时，但文件已生成: ${(stats.size / 1024).toFixed(1)} KB`);
      return { success: true, path: reviewPath };
    }
    
    return { success: false, error: error.message };
  }
}

/**
 * 测试推送到 Telegram
 */
async function testPushToTelegram(paper, reviewPath) {
  console.log(`\n📤 测试推送到 Telegram...`);
  
  if (!fs.existsSync(reviewPath)) {
    console.log('⚠️  长文未生成，跳过推送');
    return false;
  }
  
  const content = fs.readFileSync(reviewPath, 'utf-8');
  const message = `📄 **${paper.title}**\n\n${content.substring(0, 3500)}`; // 限制长度
  
  try {
    const tempFile = `/tmp/test-review-${Date.now()}.txt`;
    fs.writeFileSync(tempFile, message, 'utf-8');
    
    const cmd = `/home/useradmin/agent_workspace/scripts/tg-send.sh 5740650457 --file "${tempFile}"`; // was: openclaw message send
    
    console.log('📤 发送消息...');
    const result = execSync(cmd, { encoding: 'utf-8', timeout: 10000 });
    
    console.log('✅ 推送成功');
    console.log('响应:', result);
    
    fs.unlinkSync(tempFile);
    return true;
    
  } catch (error) {
    console.error('❌ 推送失败:', error.message);
    return false;
  }
}

/**
 * 主测试函数
 */
async function main() {
  console.log('🧪 开始简化测试');
  console.log('='.repeat(60));
  
  const paper = TEST_PAPERS[0];
  
  // 测试 1: Spawn agent
  const spawnResult = await testSpawnAgent(paper);
  
  // 测试 2: 推送到 Telegram
  if (spawnResult.success) {
    await testPushToTelegram(paper, spawnResult.path);
  }
  
  console.log('\n' + '='.repeat(60));
  console.log('✅ 测试完成');
  console.log('='.repeat(60));
}

main().catch(err => {
  console.error('❌ 测试异常:', err);
  process.exit(1);
});
