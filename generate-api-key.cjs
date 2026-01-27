#!/usr/bin/env node

/**
 * 生成安全的 API Key
 * 使用方法: node generate-api-key.js
 */

const crypto = require('crypto');

// 生成 32 字节 (256位) 的随机 API Key
const apiKey = crypto.randomBytes(32).toString('hex');

console.log('===============================================');
console.log('  生成的 API Key (请保存到 .env 文件)');
console.log('===============================================');
console.log('');
console.log('MCP_API_KEY=' + apiKey);
console.log('');
console.log('===============================================');
console.log('提示:');
console.log('1. 将上述内容复制到 .env 文件');
console.log('2. 不要泄露此 API Key');
console.log('3. 客户端调用时需要在 HTTP 头中携带:');
console.log('   Authorization: Bearer ' + apiKey);
console.log('   或');
console.log('   X-API-Key: ' + apiKey);
console.log('===============================================');
