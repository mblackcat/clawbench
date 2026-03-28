#!/usr/bin/env python3
"""Scaffold generator for ClawBench UI apps.

This tool creates a new ClawBench app with UI components based on templates.
"""

import argparse
import json
import os
import sys
from pathlib import Path


TEMPLATES = {
    "basic": {
        "description": "基础应用（无 UI）",
        "has_ui": False,
    },
    "dialog": {
        "description": "简单对话框应用",
        "has_ui": True,
        "ui_template": "dialog",
    },
    "form": {
        "description": "表单输入应用",
        "has_ui": True,
        "ui_template": "form",
    },
    "list": {
        "description": "列表选择应用",
        "has_ui": True,
        "ui_template": "list",
    },
    "conflict": {
        "description": "冲突处理应用（完整示例）",
        "has_ui": True,
        "ui_template": "conflict",
    },
}


def create_manifest(app_dir: Path, app_id: str, app_name: str, description: str):
    """Create manifest.json file."""
    manifest = {
        "id": app_id,
        "name": app_name,
        "version": "1.0.0",
        "description": description,
        "author": {"name": "Your Name"},
        "icon": "icon.png",
        "entry": "main.py",
        "supported_workspace_types": ["git"],
        "confirm_before_run": False,
        "params": [],
        "min_sdk_version": "1.0.0",
    }
    
    manifest_path = app_dir / "manifest.json"
    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)
    
    print(f"✓ 创建 {manifest_path}")


def create_basic_main(app_dir: Path):
    """Create basic main.py without UI."""
    content = '''"""ClawBench App: {app_name}"""

import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "python-sdk"))

from clawbench_sdk import ClawBenchApp


class MyApp(ClawBenchApp):
    """Main application class."""
    
    def run(self):
        """Execute the app logic."""
        self.emit_output("应用开始执行...", "info")
        self.emit_progress(10, "初始化")
        
        # TODO: 实现你的业务逻辑
        workspace_path = self.workspace.path
        self.emit_output(f"工作区路径: {workspace_path}", "info")
        
        self.emit_progress(100, "完成")
        self.emit_result(True, "执行成功")


if __name__ == "__main__":
    MyApp.execute()
'''
    
    main_path = app_dir / "main.py"
    with open(main_path, "w", encoding="utf-8") as f:
        f.write(content)
    
    print(f"✓ 创建 {main_path}")


def create_ui_main(app_dir: Path, template: str):
    """Create main.py with UI support."""
    if template == "dialog":
        content = '''"""ClawBench App with Dialog UI"""

import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "python-sdk"))

from clawbench_sdk import (
    ClawBenchApp,
    Dialog,
    Button,
    Label,
    emit_ui_show,
    emit_ui_close,
)


class MyApp(ClawBenchApp):
    """Application with dialog UI."""
    
    def run(self):
        """Execute the app logic."""
        self.emit_output("显示对话框...", "info")
        
        # 创建对话框
        dialog = Dialog(
            id="my_dialog",
            title="应用对话框",
            components=[
                Label(
                    id="message",
                    text="这是一个示例对话框",
                    style="normal"
                ),
            ],
            footer_buttons=[
                Button(id="ok_btn", label="确定", variant="primary"),
                Button(id="cancel_btn", label="取消", variant="default"),
            ]
        )
        
        emit_ui_show(dialog)
        
        # TODO: 实现事件处理逻辑
        
        self.emit_result(True, "对话框已显示")


if __name__ == "__main__":
    MyApp.execute()
'''
    elif template == "form":
        content = '''"""ClawBench App with Form UI"""

import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "python-sdk"))

from clawbench_sdk import (
    ClawBenchApp,
    Dialog,
    Button,
    Label,
    TextInput,
    TextArea,
    Dropdown,
    emit_ui_show,
    load_ui_from_json,
)


class MyApp(ClawBenchApp):
    """Application with form UI."""
    
    def run(self):
        """Execute the app logic."""
        self.emit_output("显示表单...", "info")
        
        # 从 ui.json 加载 UI 定义
        ui_path = os.path.join(os.path.dirname(__file__), "ui.json")
        dialog = load_ui_from_json(ui_path)
        
        emit_ui_show(dialog)
        
        # TODO: 实现表单提交逻辑
        
        self.emit_result(True, "表单已显示")


if __name__ == "__main__":
    MyApp.execute()
'''
    elif template == "list":
        content = '''"""ClawBench App with List Selection UI"""

import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "python-sdk"))

from clawbench_sdk import (
    ClawBenchApp,
    Dialog,
    Button,
    CheckboxList,
    emit_ui_show,
    emit_ui_update,
)


class MyApp(ClawBenchApp):
    """Application with list selection UI."""
    
    def run(self):
        """Execute the app logic."""
        self.emit_output("显示选择列表...", "info")
        
        # 创建对话框
        dialog = Dialog(
            id="selection_dialog",
            title="选择项目",
            components=[
                Button(id="select_all_btn", label="全选", variant="default"),
                Button(id="clear_btn", label="清空", variant="default"),
                CheckboxList(
                    id="item_list",
                    items=[
                        {"id": "1", "label": "项目 1", "description": "描述 1"},
                        {"id": "2", "label": "项目 2", "description": "描述 2"},
                        {"id": "3", "label": "项目 3", "description": "描述 3"},
                    ],
                    selected_ids=[],
                    max_height=300
                ),
            ],
            footer_buttons=[
                Button(id="ok_btn", label="确定", variant="primary"),
                Button(id="cancel_btn", label="取消", variant="default"),
            ]
        )
        
        emit_ui_show(dialog)
        
        # TODO: 实现选择处理逻辑
        
        self.emit_result(True, "列表已显示")


if __name__ == "__main__":
    MyApp.execute()
'''
    else:  # conflict template
        # Copy from existing vcs_update_with_conflicts
        source_path = Path(__file__).parent.parent / "builtin-apps" / "vcs_update_with_conflicts" / "main.py"
        if source_path.exists():
            with open(source_path, "r", encoding="utf-8") as f:
                content = f.read()
        else:
            content = "# TODO: Implement conflict resolution app\n"
    
    main_path = app_dir / "main.py"
    with open(main_path, "w", encoding="utf-8") as f:
        f.write(content)
    
    print(f"✓ 创建 {main_path}")


def create_ui_json(app_dir: Path, template: str):
    """Create ui.json file based on template."""
    if template == "dialog":
        ui_def = {
            "id": "my_dialog",
            "title": "对话框标题",
            "closable": True,
            "width": 400,
            "components": [
                {
                    "type": "label",
                    "id": "message",
                    "text": "这是一个示例对话框",
                    "style": "normal",
                    "visible": True
                }
            ],
            "footer_buttons": [
                {
                    "type": "button",
                    "id": "ok_btn",
                    "label": "确定",
                    "variant": "primary",
                    "enabled": True,
                    "visible": True
                },
                {
                    "type": "button",
                    "id": "cancel_btn",
                    "label": "取消",
                    "variant": "default",
                    "enabled": True,
                    "visible": True
                }
            ]
        }
    elif template == "form":
        ui_def = {
            "id": "form_dialog",
            "title": "输入信息",
            "closable": True,
            "width": 500,
            "components": [
                {
                    "type": "label",
                    "id": "name_label",
                    "text": "名称：",
                    "style": "bold",
                    "visible": True
                },
                {
                    "type": "text_input",
                    "id": "name_input",
                    "value": "",
                    "placeholder": "请输入名称",
                    "enabled": True,
                    "visible": True
                },
                {
                    "type": "label",
                    "id": "desc_label",
                    "text": "描述：",
                    "style": "bold",
                    "visible": True
                },
                {
                    "type": "text_area",
                    "id": "desc_input",
                    "value": "",
                    "placeholder": "请输入描述",
                    "rows": 4,
                    "enabled": True,
                    "visible": True
                }
            ],
            "footer_buttons": [
                {
                    "type": "button",
                    "id": "submit_btn",
                    "label": "提交",
                    "variant": "primary",
                    "enabled": True,
                    "visible": True
                },
                {
                    "type": "button",
                    "id": "cancel_btn",
                    "label": "取消",
                    "variant": "default",
                    "enabled": True,
                    "visible": True
                }
            ]
        }
    elif template == "list":
        ui_def = {
            "id": "selection_dialog",
            "title": "选择项目",
            "closable": True,
            "width": 600,
            "components": [
                {
                    "type": "button",
                    "id": "select_all_btn",
                    "label": "全选",
                    "variant": "default",
                    "enabled": True,
                    "visible": True
                },
                {
                    "type": "button",
                    "id": "clear_btn",
                    "label": "清空",
                    "variant": "default",
                    "enabled": True,
                    "visible": True
                },
                {
                    "type": "checkbox_list",
                    "id": "item_list",
                    "items": [],
                    "selected_ids": [],
                    "max_height": 400,
                    "enabled": True,
                    "visible": True
                }
            ],
            "footer_buttons": [
                {
                    "type": "button",
                    "id": "ok_btn",
                    "label": "确定",
                    "variant": "primary",
                    "enabled": True,
                    "visible": True
                },
                {
                    "type": "button",
                    "id": "cancel_btn",
                    "label": "取消",
                    "variant": "default",
                    "enabled": True,
                    "visible": True
                }
            ]
        }
    else:  # conflict
        # Copy from existing template
        source_path = Path(__file__).parent.parent / "builtin-apps" / "vcs_update_with_conflicts" / "ui.json"
        if source_path.exists():
            with open(source_path, "r", encoding="utf-8") as f:
                ui_def = json.load(f)
        else:
            return
    
    ui_path = app_dir / "ui.json"
    with open(ui_path, "w", encoding="utf-8") as f:
        json.dump(ui_def, f, indent=2, ensure_ascii=False)
    
    print(f"✓ 创建 {ui_path}")


def create_readme(app_dir: Path, app_name: str, template: str):
    """Create README.md file."""
    content = f"""# {app_name}

## 描述

TODO: 添加应用描述

## 使用方法

1. 在 ClawBench 中打开工作区
2. 运行此应用
3. 按照界面提示操作

## 开发

### 文件结构

- `manifest.json` - 应用元数据和参数定义
- `main.py` - 主程序入口
"""
    
    if template != "basic":
        content += "- `ui.json` - UI 界面定义\n"
    
    content += """
### 调试

```bash
python main.py --params params.json --workspace workspace.json
```

## 参考文档

- [UI Guide](../../docs/UI_GUIDE.md)
- [UI Reference](../../docs/UI_REFERENCE.md)
"""
    
    readme_path = app_dir / "README.md"
    with open(readme_path, "w", encoding="utf-8") as f:
        f.write(content)
    
    print(f"✓ 创建 {readme_path}")


def main():
    parser = argparse.ArgumentParser(
        description="创建 ClawBench UI 应用脚手架"
    )
    parser.add_argument(
        "name",
        help="应用名称（目录名）"
    )
    parser.add_argument(
        "--template",
        choices=list(TEMPLATES.keys()),
        default="dialog",
        help="应用模板类型"
    )
    parser.add_argument(
        "--id",
        help="应用 ID（默认：com.example.<name>）"
    )
    parser.add_argument(
        "--title",
        help="应用显示名称（默认：使用 name）"
    )
    parser.add_argument(
        "--description",
        default="",
        help="应用描述"
    )
    parser.add_argument(
        "--output",
        default="builtin-apps",
        help="输出目录（默认：builtin-apps）"
    )
    
    args = parser.parse_args()
    
    # 准备参数
    app_name = args.name
    app_id = args.id or f"com.example.{app_name.replace('_', '-')}"
    app_title = args.title or app_name.replace("_", " ").title()
    description = args.description or TEMPLATES[args.template]["description"]
    template = args.template
    
    # 创建应用目录
    output_dir = Path(args.output)
    app_dir = output_dir / app_name
    
    if app_dir.exists():
        print(f"错误: 目录 {app_dir} 已存在")
        sys.exit(1)
    
    app_dir.mkdir(parents=True, exist_ok=True)
    print(f"\n创建应用: {app_title}")
    print(f"目录: {app_dir}")
    print(f"模板: {template} - {TEMPLATES[template]['description']}\n")
    
    # 创建文件
    create_manifest(app_dir, app_id, app_title, description)
    
    if TEMPLATES[template]["has_ui"]:
        create_ui_main(app_dir, TEMPLATES[template]["ui_template"])
        create_ui_json(app_dir, TEMPLATES[template]["ui_template"])
    else:
        create_basic_main(app_dir)
    
    create_readme(app_dir, app_title, template)
    
    print(f"\n✅ 应用创建成功！")
    print(f"\n下一步:")
    print(f"  1. cd {app_dir}")
    print(f"  2. 编辑 main.py 实现业务逻辑")
    if TEMPLATES[template]["has_ui"]:
        print(f"  3. 根据需要修改 ui.json 调整界面")
    print(f"  4. 在 ClawBench 中测试应用")


if __name__ == "__main__":
    main()
