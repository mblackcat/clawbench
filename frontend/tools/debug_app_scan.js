#!/usr/bin/env node

/**
 * 调试脚本：模拟 Electron 应用扫描 user-apps 目录
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// 模拟 getUserAppsPath
function getUserAppsPath() {
  const platform = os.platform();
  let appDataPath;
  
  if (platform === 'darwin') {
    appDataPath = path.join(os.homedir(), 'Library', 'Application Support', 'clawbench');
  } else if (platform === 'win32') {
    appDataPath = path.join(os.homedir(), 'AppData', 'Roaming', 'clawbench');
  } else {
    appDataPath = path.join(os.homedir(), '.config', 'clawbench');
  }
  
  return path.join(appDataPath, 'user-apps');
}

// 模拟 scanAppsDir
function scanAppsDir(dir, source) {
  const apps = [];
  
  console.log(`\n扫描目录: ${dir}`);
  console.log(`来源: ${source}`);
  
  if (!fs.existsSync(dir)) {
    console.log(`❌ 目录不存在`);
    return apps;
  }
  
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    console.log(`找到 ${entries.length} 个条目`);
    
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        console.log(`  ⊘ ${entry.name} (不是目录)`);
        continue;
      }
      
      const appDir = path.join(dir, entry.name);
      const manifestPath = path.join(appDir, 'manifest.json');
      
      console.log(`\n  检查: ${entry.name}/`);
      
      if (!fs.existsSync(manifestPath)) {
        console.log(`    ❌ 没有 manifest.json`);
        continue;
      }
      
      try {
        const manifestContent = fs.readFileSync(manifestPath, 'utf-8');
        const manifest = JSON.parse(manifestContent);
        
        console.log(`    ✓ manifest.json 有效`);
        console.log(`      ID: ${manifest.id}`);
        console.log(`      名称: ${manifest.name}`);
        console.log(`      版本: ${manifest.version}`);
        console.log(`      入口: ${manifest.entry}`);
        
        apps.push({
          id: manifest.id,
          manifest: manifest,
          path: appDir,
          source: source
        });
      } catch (err) {
        console.log(`    ❌ 读取 manifest.json 失败: ${err.message}`);
      }
    }
  } catch (err) {
    console.log(`❌ 扫描目录失败: ${err.message}`);
  }
  
  return apps;
}

// 主函数
function main() {
  console.log('='.repeat(60));
  console.log('ClawBench 应用扫描调试');
  console.log('='.repeat(60));
  
  const userAppsPath = getUserAppsPath();
  console.log(`\n用户应用目录: ${userAppsPath}`);
  
  const userApps = scanAppsDir(userAppsPath, 'user');
  
  console.log('\n' + '='.repeat(60));
  console.log(`扫描结果: 找到 ${userApps.length} 个用户应用`);
  console.log('='.repeat(60));
  
  if (userApps.length > 0) {
    console.log('\n应用列表:');
    userApps.forEach((app, index) => {
      console.log(`\n${index + 1}. ${app.manifest.name}`);
      console.log(`   ID: ${app.manifest.id}`);
      console.log(`   版本: ${app.manifest.version}`);
      console.log(`   路径: ${app.path}`);
      console.log(`   来源: ${app.source}`);
    });
  }
  
  console.log('\n' + '='.repeat(60));
  console.log('调试完成');
  console.log('='.repeat(60));
  
  // 返回结果供其他脚本使用
  return userApps;
}

// 运行
if (require.main === module) {
  main();
}

module.exports = { getUserAppsPath, scanAppsDir, main };
