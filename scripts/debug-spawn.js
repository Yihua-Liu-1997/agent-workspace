#!/usr/bin/env node
/**
 * 调试 spawn API - 带认证
 */

const WebSocket = require('ws');
const crypto = require('crypto');

const token = process.env.OPENCLAW_GATEWAY_TOKEN || 'b619a2296d762930074c97fc48c4e1afa4213f2bcccab682';
const ws = new WebSocket('ws://127.0.0.1:18789');

let authenticated = false;

ws.on('open', () => {
  console.log('✅ Connected to Gateway, waiting for challenge...\n');
});

ws.on('message', (data) => {
  console.log('📥 Received message:');
  try {
    const msg = JSON.parse(data);
    console.log(JSON.stringify(msg, null, 2));
    console.log('');
    
    // 处理 challenge
    if (msg.event === 'connect.challenge') {
      console.log('🔐 Responding to challenge...');
      
      // 尝试不同的认证方式
      // 方式 1: 直接发送 token
      const authResponse1 = {
        type: 'auth',
        token: token
      };
      
      // 方式 2: 使用 HMAC
      const hmac = crypto.createHmac('sha256', token);
      hmac.update(msg.payload.nonce);
      const signature = hmac.digest('hex');
      
      const authResponse2 = {
        type: 'auth',
        nonce: msg.payload.nonce,
        signature: signature
      };
      
      // 方式 3: JSON-RPC 格式
      const authResponse3 = {
        jsonrpc: '2.0',
        method: 'auth',
        params: {
          token: token
        },
        id: 'auth-1'
      };
      
      console.log('📤 Trying auth method 1 (direct token):');
      console.log(JSON.stringify(authResponse1, null, 2));
      ws.send(JSON.stringify(authResponse1));
      
      // 等待看是否成功
      setTimeout(() => {
        if (!authenticated) {
          console.log('\n📤 Trying auth method 2 (HMAC signature):');
          console.log(JSON.stringify(authResponse2, null, 2));
          ws.send(JSON.stringify(authResponse2));
        }
      }, 2000);
      
      setTimeout(() => {
        if (!authenticated) {
          console.log('\n📤 Trying auth method 3 (JSON-RPC):');
          console.log(JSON.stringify(authResponse3, null, 2));
          ws.send(JSON.stringify(authResponse3));
        }
      }, 4000);
    }
    
    // 处理认证成功
    if (msg.event === 'connect.authenticated' || msg.result === 'authenticated') {
      console.log('✅ Authenticated successfully!\n');
      authenticated = true;
      
      // 发送 spawn 请求
      const request = {
        jsonrpc: '2.0',
        method: 'sessions_spawn',
        params: {
          label: 'debug-test',
          mode: 'run',
          runtime: 'subagent',
          task: '测试任务：输出 hello world',
          timeoutSeconds: 60
        },
        id: 'test-1'
      };
      
      console.log('📤 Sending spawn request:');
      console.log(JSON.stringify(request, null, 2));
      console.log('');
      ws.send(JSON.stringify(request));
    }
    
    // 处理 spawn 响应
    if (msg.id === 'test-1') {
      console.log('✅ Spawn response received:');
      console.log(JSON.stringify(msg, null, 2));
      setTimeout(() => ws.close(), 2000);
    }
    
  } catch (e) {
    console.log(data.toString());
  }
});

ws.on('error', (error) => {
  console.error('❌ Error:', error.message);
});

ws.on('close', () => {
  console.log('🔌 Connection closed');
  process.exit(0);
});

// 15 秒后关闭
setTimeout(() => {
  console.log('⏰ Timeout, closing...');
  ws.close();
}, 15000);
