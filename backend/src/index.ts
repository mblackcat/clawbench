import { createApp } from './app';
import { database } from './database';
import { initializeSchema } from './database/schema';
import { config } from './config';
import { logger } from './utils/logger';

/**
 * 启动服务器
 */
async function startServer() {
  try {
    // 连接数据库
    await database.connect();

    // 初始化数据库表结构（PM2 cluster 模式下仅主实例执行，避免并发 DDL 冲突）
    const instanceId = process.env.NODE_APP_INSTANCE;
    if (!instanceId || instanceId === '0') {
      await initializeSchema();
    } else {
      // 非主实例等待一小段时间，确保主实例完成 schema 初始化
      await new Promise(resolve => setTimeout(resolve, 2000));
      logger.info(`Worker ${instanceId} skipped schema init (handled by primary)`);
    }

    // 创建应用
    const app = createApp();

    // 启动服务器
    app.listen(config.port, () => {
      logger.info(`Server is running on port ${config.port}`);
      logger.info(`Environment: ${config.nodeEnv}`);
      logger.info(`API endpoint: http://localhost:${config.port}/api/v1`);
    });

    // 优雅关闭
    process.on('SIGTERM', async () => {
      logger.info('SIGTERM signal received: closing HTTP server');
      await database.close();
      process.exit(0);
    });

    process.on('SIGINT', async () => {
      logger.info('SIGINT signal received: closing HTTP server');
      await database.close();
      process.exit(0);
    });
  } catch (error) {
    logger.error('Failed to start server', error);
    process.exit(1);
  }
}

// 启动服务器
startServer();
