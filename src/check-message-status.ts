#!/usr/bin/env node
/**
 * 查询钉钉消息发送状态
 */

import fetch from 'node-fetch';
import dotenv from 'dotenv';

dotenv.config();

async function getAccessToken(): Promise<string> {
  const appKey = process.env.DINGTALK_APP_KEY;
  const appSecret = process.env.DINGTALK_APP_SECRET;
  
  const url = `https://oapi.dingtalk.com/gettoken?appkey=${appKey}&appsecret=${appSecret}`;
  const response = await fetch(url);
  const result = await response.json() as any;
  
  if (result.errcode !== 0) {
    throw new Error(`获取AccessToken失败: ${result.errmsg}`);
  }
  
  return result.access_token;
}

async function checkMessageStatus(taskId: string) {
  console.log('='.repeat(60));
  console.log('查询钉钉消息发送状态');
  console.log('='.repeat(60));
  
  console.log('\nTask ID:', taskId);
  
  // 获取AccessToken
  console.log('\n1️⃣ 获取AccessToken...');
  const accessToken = await getAccessToken();
  console.log('✅ AccessToken获取成功');
  
  // 查询发送进度
  console.log('\n2️⃣ 查询发送进度...');
  const progressUrl = `https://oapi.dingtalk.com/topapi/message/corpconversation/getsendprogress?access_token=${accessToken}`;
  
  const progressResponse = await fetch(progressUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agent_id: process.env.DINGTALK_AGENT_ID, task_id: parseInt(taskId) }),
  });
  
  const progressResult = await progressResponse.json() as any;
  console.log('进度查询结果:', JSON.stringify(progressResult, null, 2));
  
  if (progressResult.errcode === 0) {
    console.log('\n📊 发送进度:');
    console.log('  - 状态:', progressResult.result.progress === 100 ? '✅ 已完成' : `⏳ 进行中 (${progressResult.result.progress}%)`);
  }
  
  // 查询发送结果
  console.log('\n3️⃣ 查询发送结果...');
  const resultUrl = `https://oapi.dingtalk.com/topapi/message/corpconversation/getsendresult?access_token=${accessToken}`;
  
  const resultResponse = await fetch(resultUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agent_id: process.env.DINGTALK_AGENT_ID, task_id: parseInt(taskId) }),
  });
  
  const sendResult = await resultResponse.json() as any;
  console.log('发送结果:', JSON.stringify(sendResult, null, 2));
  
  if (sendResult.errcode === 0) {
    console.log('\n📊 发送结果详情:');
    
    if (sendResult.result.send_result) {
      const result = sendResult.result.send_result;
      
      if (result.success_user_id_list && result.success_user_id_list.length > 0) {
        console.log('  ✅ 发送成功:', result.success_user_id_list.join(', '));
      }
      
      if (result.failed_user_id_list && result.failed_user_id_list.length > 0) {
        console.log('  ❌ 发送失败:', result.failed_user_id_list.join(', '));
      }
      
      if (result.forbidden_user_id_list && result.forbidden_user_id_list.length > 0) {
        console.log('  🚫 被限制用户:', result.forbidden_user_id_list.join(', '));
        console.log('     原因: 超出消息发送次数限制');
      }
      
      if (result.read_user_id_list && result.read_user_id_list.length > 0) {
        console.log('  👁️  已读用户:', result.read_user_id_list.join(', '));
      }
      
      if (result.unread_user_id_list && result.unread_user_id_list.length > 0) {
        console.log('  📭 未读用户:', result.unread_user_id_list.join(', '));
      }
      
      if (result.invalid_user_id_list && result.invalid_user_id_list.length > 0) {
        console.log('  ⚠️  无效用户:', result.invalid_user_id_list.join(', '));
      }
    }
  }
  
  console.log('\n' + '='.repeat(60));
  console.log('查询完成');
  console.log('='.repeat(60));
}

// 运行查询
const taskId = process.argv[2];

if (!taskId) {
  console.error('❌ 请提供task_id');
  console.error('用法: node build/check-message-status.js <task_id>');
  console.error('例如: node build/check-message-status.js 89359583964269');
  process.exit(1);
}

checkMessageStatus(taskId).catch(error => {
  console.error('查询失败:', error);
  process.exit(1);
});
