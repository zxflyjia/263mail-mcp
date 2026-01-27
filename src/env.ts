/**
 * 环境变量验证模块
 */

const REQUIRED_ENV_VARS = [
  'MAIL_263_ACCOUNT',
  'MAIL_263_SECRET',
  'MAIL_263_DOMAIN',
  'DINGTALK_APP_KEY',
  'DINGTALK_APP_SECRET',
  'DINGTALK_AGENT_ID',
];

/**
 * 验证所有必需的环境变量
 */
export function validateEnv(): void {
  for (const envVar of REQUIRED_ENV_VARS) {
    if (!process.env[envVar]) {
      console.error(`错误: 缺少必需的环境变量 ${envVar}`);
      process.exit(1);
    }
  }

  // 输出配置信息用于调试（不输出敏感信息）
  console.error('[MCP] 环境变量配置:');
  console.error('[MCP] MAIL_263_ACCOUNT:', process.env.MAIL_263_ACCOUNT);
  console.error('[MCP] MAIL_263_DOMAIN:', process.env.MAIL_263_DOMAIN);
  console.error('[MCP] DINGTALK_AGENT_ID:', process.env.DINGTALK_AGENT_ID);
  console.error(
    '[MCP] DINGTALK_APP_KEY:',
    process.env.DINGTALK_APP_KEY?.substring(0, 10) + '...'
  );
}
