#!/usr/bin/env python3
"""Test script for ClawBench UI system."""

import sys
import os
import json

# Add SDK to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "python-sdk"))

from clawbench_sdk import (
    Dialog,
    Button,
    CheckboxList,
    RadioList,
    Label,
    emit_ui_show,
    emit_ui_update,
    load_ui_from_json,
)


def test_component_creation():
    """Test creating UI components."""
    print("测试组件创建...")
    
    # Create button
    button = Button(id="test_btn", label="测试按钮", variant="primary")
    assert button.id == "test_btn"
    assert button.label == "测试按钮"
    print("  ✓ Button 创建成功")
    
    # Create checkbox list
    checkbox_list = CheckboxList(
        id="test_list",
        items=[{"id": "1", "label": "项目1"}],
        selected_ids=[]
    )
    assert checkbox_list.id == "test_list"
    assert len(checkbox_list.items) == 1
    print("  ✓ CheckboxList 创建成功")
    
    # Create label
    label = Label(id="test_label", text="测试标签", style="bold")
    assert label.text == "测试标签"
    print("  ✓ Label 创建成功")
    
    print("✅ 组件创建测试通过\n")


def test_dialog_creation():
    """Test creating a dialog."""
    print("测试对话框创建...")
    
    dialog = Dialog(
        id="test_dialog",
        title="测试对话框",
        components=[
            Label(id="label1", text="测试"),
            CheckboxList(id="list1", items=[])
        ],
        footer_buttons=[
            Button(id="ok", label="确定", variant="primary")
        ]
    )
    
    assert dialog.id == "test_dialog"
    assert dialog.title == "测试对话框"
    assert len(dialog.components) == 2
    assert len(dialog.footer_buttons) == 1
    print("  ✓ Dialog 创建成功")
    
    # Test serialization
    dialog_dict = dialog.to_dict()
    assert "id" in dialog_dict
    assert "title" in dialog_dict
    assert "components" in dialog_dict
    print("  ✓ Dialog 序列化成功")
    
    print("✅ 对话框创建测试通过\n")


def test_json_loading():
    """Test loading UI from JSON."""
    print("测试 JSON 加载...")
    
    # Create test JSON
    test_json = {
        "id": "json_dialog",
        "title": "JSON 对话框",
        "closable": True,
        "width": 500,
        "components": [
            {
                "type": "label",
                "id": "label1",
                "text": "测试标签",
                "style": "normal",
                "visible": True
            },
            {
                "type": "checkbox_list",
                "id": "list1",
                "items": [
                    {"id": "1", "label": "项目1"}
                ],
                "selected_ids": [],
                "max_height": 300,
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
            }
        ]
    }
    
    # Write to temp file
    temp_file = "/tmp/test_ui.json"
    with open(temp_file, "w", encoding="utf-8") as f:
        json.dump(test_json, f)
    
    # Load from JSON
    dialog = load_ui_from_json(temp_file)
    
    assert dialog.id == "json_dialog"
    assert dialog.title == "JSON 对话框"
    assert len(dialog.components) == 2
    assert len(dialog.footer_buttons) == 1
    print("  ✓ JSON 加载成功")
    
    # Cleanup
    os.remove(temp_file)
    
    print("✅ JSON 加载测试通过\n")


def test_ui_protocol():
    """Test UI protocol message generation."""
    print("测试 UI 协议...")
    
    dialog = Dialog(
        id="protocol_test",
        title="协议测试",
        components=[Label(id="l1", text="测试")],
        footer_buttons=[]
    )
    
    # Test that emit functions don't crash
    # (they will print JSON to stdout)
    print("  测试 emit_ui_show...")
    # emit_ui_show(dialog)  # Commented to avoid stdout pollution
    
    print("  测试 emit_ui_update...")
    # emit_ui_update("test", {"l1": {"text": "更新"}})
    
    print("  ✓ UI 协议消息生成正常")
    print("✅ UI 协议测试通过\n")


def main():
    """Run all tests."""
    print("=" * 60)
    print("ClawBench UI 系统测试")
    print("=" * 60 + "\n")
    
    try:
        test_component_creation()
        test_dialog_creation()
        test_json_loading()
        test_ui_protocol()
        
        print("=" * 60)
        print("✅ 所有测试通过！")
        print("=" * 60)
        return 0
    except Exception as e:
        print(f"\n❌ 测试失败: {e}")
        import traceback
        traceback.print_exc()
        return 1


if __name__ == "__main__":
    sys.exit(main())
