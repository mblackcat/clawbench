#!/bin/bash

# 验证用户应用安装脚本

echo "=========================================="
echo "ClawBench 用户应用验证"
echo "=========================================="
echo ""

# 定义路径
USER_APPS_DIR="$HOME/Library/Application Support/clawbench/user-apps"
APP_DIR="$USER_APPS_DIR/vcs_update_with_conflicts"

# 检查用户应用目录
echo "1. 检查用户应用目录..."
if [ -d "$USER_APPS_DIR" ]; then
    echo "   ✓ 用户应用目录存在: $USER_APPS_DIR"
else
    echo "   ✗ 用户应用目录不存在"
    exit 1
fi

# 检查应用目录
echo ""
echo "2. 检查应用目录..."
if [ -d "$APP_DIR" ]; then
    echo "   ✓ 应用目录存在: $APP_DIR"
else
    echo "   ✗ 应用目录不存在"
    exit 1
fi

# 检查必需文件
echo ""
echo "3. 检查必需文件..."
files=("manifest.json" "main.py" "ui.json" "README.md")
all_exist=true

for file in "${files[@]}"; do
    if [ -f "$APP_DIR/$file" ]; then
        echo "   ✓ $file"
    else
        echo "   ✗ $file 不存在"
        all_exist=false
    fi
done

if [ "$all_exist" = false ]; then
    exit 1
fi

# 验证 manifest.json 格式
echo ""
echo "4. 验证 manifest.json 格式..."
if python -m json.tool "$APP_DIR/manifest.json" > /dev/null 2>&1; then
    echo "   ✓ manifest.json 格式正确"
else
    echo "   ✗ manifest.json 格式错误"
    exit 1
fi

# 验证 ui.json 格式
echo ""
echo "5. 验证 ui.json 格式..."
if python -m json.tool "$APP_DIR/ui.json" > /dev/null 2>&1; then
    echo "   ✓ ui.json 格式正确"
else
    echo "   ✗ ui.json 格式错误"
    exit 1
fi

# 验证 Python 语法
echo ""
echo "6. 验证 Python 语法..."
if python -m py_compile "$APP_DIR/main.py" 2>/dev/null; then
    echo "   ✓ main.py 语法正确"
else
    echo "   ✗ main.py 语法错误"
    exit 1
fi

# 显示应用信息
echo ""
echo "7. 应用信息..."
app_id=$(python -c "import json; print(json.load(open('$APP_DIR/manifest.json'))['id'])" 2>/dev/null)
app_name=$(python -c "import json; print(json.load(open('$APP_DIR/manifest.json'))['name'])" 2>/dev/null)
app_version=$(python -c "import json; print(json.load(open('$APP_DIR/manifest.json'))['version'])" 2>/dev/null)

echo "   应用 ID: $app_id"
echo "   应用名称: $app_name"
echo "   版本: $app_version"

# 列出所有用户应用
echo ""
echo "8. 所有用户应用..."
for dir in "$USER_APPS_DIR"/*; do
    if [ -d "$dir" ]; then
        dirname=$(basename "$dir")
        if [ -f "$dir/manifest.json" ]; then
            name=$(python -c "import json; print(json.load(open('$dir/manifest.json')).get('name', 'Unknown'))" 2>/dev/null)
            echo "   - $dirname ($name)"
        else
            echo "   - $dirname (无 manifest.json)"
        fi
    fi
done

echo ""
echo "=========================================="
echo "✅ 验证完成！应用已正确安装"
echo "=========================================="
echo ""
echo "下一步："
echo "1. 启动 ClawBench 应用"
echo "2. 进入'已装应用'或'应用中心'页面"
echo "3. 查找'更新工作区（智能冲突处理）'应用"
echo "4. 打开一个 Git 工作区并运行应用"
echo ""
echo "详细使用说明请查看: docs/INSTALL_USER_APP.md"
