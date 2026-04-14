#!/usr/bin/env node
/**
 * 测试 spawn sub-agent 功能
 */

const fs = require('fs');
const WebSocket = require('ws');

const CONFIG = {
  gatewayUrl: 'ws://127.0.0.1:18789',
  gatewayToken: 'b619a2296d762930074c97fc48c4e1afa4213f2bcccab682',
  telegramChatId: '5740650457',
  reviewBaseDir: '/home/useradmin/agent_workspace/data/paper-reviews'
};

// 测试数据 - 使用一篇真实论文
const TEST_PAPER = {
  arxiv_id: '2403.09513',  // 一篇最近的论文
  title: 'Test Paper - Deep Learning',
  likes: 10,
  views: 1000
};

/**
 * 创建已认证的 WebSocket 连接
 */
async function createAuthenticatedConnection() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(CONFIG.gatewayUrl);
    
    ws.on('open', () => {
      console.log('✅ WebSocket 已连接');
    });
    
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data);
        
        // 处理认证 challenge
        if (msg.type === 'event' && msg.event === 'connect.challenge') {
          console.log('🔐 收到认证 challenge，发送 token...');
          
          // 发送认证响应
          const authResponse = {
            jsonrpc: '2.0',
            method: 'authenticate',
            params: {
              token: CONFIG.gatewayToken
            },
            id: 'auth-' + Date.now()
          };
          
          ws.send(JSON.stringify(authResponse));
          return;
        }
        
        // 处理认证成功
        if (msg.result && msg.id && msg.id.startsWith('auth-')) {
          console.log('✅ 认证成功！\n');
          resolve(ws);
          return;
        }
        
        // 处理认证失败
        if (msg.error && msg.id && msg.id.startsWith('auth-')) {
          console.error('❌ 认证失败:', msg.error);
          ws.close();
          reject(new Error('认证失败: ' + msg.error.message));
          return;
        }
      } catch (e) {
        // 忽略解析错误
      }
    });
    
    ws.on('error', (error) => {
      console.error('❌ WebSocket 错误:', error.message);
      reject(error);
    });
    
    // 超时
    setTimeout(() => {
      ws.close();
      reject(new Error('认证超时'));
    }, 10000);
  });
}

/**
 * 连接 Gateway 并测试基本连接
 */
async function testConnection() {
  return new Promise(async (resolve, reject) => {
    console.log('🔌 测试连接到 OpenClaw Gateway...');
    
    try {
      const ws = await createAuthenticatedConnection();
      ws.close();
      resolve(true);
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * 测试 spawn sub-agent
 */
async function testSpawnSubAgent() {
  return new Promise(async (resolve, reject) => {
    console.log('🚀 测试 spawn sub-agent...');
    
    try {
      const ws = await createAuthenticatedConnection();
      
      const today = new Date().toISOString().slice(0, 10);
      const label = `测试长文-${TEST_PAPER.arxiv_id}`;
      
      // 简化的任务，只测试能否正常 spawn
      const task = `测试任务：读取 arXiv 论文 HTML 版本 https://arxiv.org/html/${TEST_PAPER.arxiv_id}，写一个简短的摘要（100-200字），保存到 ${CONFIG.reviewBaseDir}/${today}/${TEST_PAPER.arxiv_id}.md`;
      
      const request = {
        jsonrpc: '2.0',
        method: 'sessions_spawn',
        params: {
          label: label,
          mode: 'run',
          runtime: 'subagent',
          task: task,
          timeoutSeconds: 120  // 2 分钟测试
        },
        id: `test-${Date.now()}`
      };
      
      console.log(`📤 发送 spawn 请求: ${label}`);
      ws.send(JSON.stringify(request));
      
      // 监听响应
      const messageHandler = (data) => {
        try {
          const response = JSON.parse(data);
          
          // 跳过认证相关的消息
          if (response.id && response.id.startsWith('auth-')) {
            return;
          }
          
          console.log('📥 收到响应:', JSON.stringify(response, null, 2));
          
          if (response.id === request.id) {
            ws.removeListener('message', messageHandler);
            ws.close();
            
            if (response.result) {
              console.log('\n✅ Spawn 成功！');
              console.log('   Session ID:', response.result.sessionId || 'N/A');
              resolve(response.result);
            } else if (response.error) {
              console.error('\n❌ Spawn 失败:', response.error);
              reject(new Error(response.error.message || 'Unknown error'));
            }
          }
        } catch (e) {
          // 忽略解析错误
        }
      };
      
      ws.on('message', messageHandler);
      
      // 超时
      setTimeout(() => {
        ws.removeListener('message', messageHandler);
        ws.close();
        reject(new Error('等待 spawn 响应超时'));
      }, 15000);
      
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * 测试推送消息到 Telegram
 */
async function testPushToTelegram() {
  return new Promise(async (resolve, reject) => {
    console.log('\n📤 测试推送消息到 Telegram...');
    
    try {
      const ws = await createAuthenticatedConnection();
      
      const testMessage = `🧪 **测试消息**\n\n这是一个测试消息，用于验证 Telegram 推送功能。\n\n时间: ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`;
      
      const request = {
        jsonrpc: '2.0',
        method: 'message_send',
        params: {
          action: 'send',
          target: CONFIG.telegramChatId,
          message: testMessage
        },
        id: `test-msg-${Date.now()}`
      };
      
      console.log('📤 发送测试消息...');
      ws.send(JSON.stringify(request));
      
      // 监听响应
      const messageHandler = (data) => {
        try {
          const response = JSON.parse(data);
          
          // 跳过认证相关的消息
          if (response.id && response.id.startsWith('auth-')) {
            return;
          }
          
          console.log('📥 收到响应:', JSON.stringify(response, null, 2));
          
          if (response.id === request.id) {
            ws.removeListener('message', messageHandler);
            ws.close();
            
            if (response.result || (response.error && response.error.code === -32601)) {
              // 如果方法不存在，可能是 API 名称不对
              console.log('\n⚠️  message_send 方法可能不可用');
              console.log('💡 尝试使用其他方法...');
              resolve(false);
            } else if (response.error) {
              console.error('\n❌ 推送失败:', response.error);
              reject(new Error(response.error.message));
            } else {
              console.log('\n✅ 推送成功！');
              resolve(true);
            }
          }
        } catch (e) {
          // 忽略解析错误
        }
      };
      
      ws.on('message', messageHandler);
      
      setTimeout(() => {
        ws.removeListener('message', messageHandler);
        ws.close();
        reject(new Error('推送超时'));
      }, 10000);
      
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * 主测试函数
 */
async function main() {
  console.log('🧪 开始测试 spawn sub-agent 功能\n');
  console.log('='.repeat(60) + '\n');
  
  try {
    // 测试 1: 连接
    await testConnection();
    
    // 测试 2: Spawn
    await testSpawnSubAgent();
    
    // 测试 3: 推送（可选）
    try {
      await testPushToTelegram();
    } catch (e) {
      console.log('⚠️  Telegram 推送测试跳过:', e.message);
    }
    
    console.log('\n' + '='.repeat(60));
    console.log('✅ 所有测试完成！');
    console.log('='.repeat(60));
    
  } catch (error) {
    console.error('\n' + '='.repeat(60));
    console.error('❌ 测试失败:', error.message);
    console.error('='.repeat(60));
    process.exit(1);
  }
}

// 运行测试
if (require.main === module) {
  main().catch(err => {
    console.error('❌ 测试异常:', err);
    process.exit(1);
  });
}

module.exports = { testConnection, testSpawnSubAgent, testPushToTelegram };
