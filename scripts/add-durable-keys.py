#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""补全 durable + starask 翻译 key"""
import json, io, sys

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

REPO = r"D:\OneDrive\steven\code\ai\13IDE\wave"

DATA = {
    "en": {
        "durable": {
            "title": "Durable Sessions",
            "protectedBadge": "Protected",
            "desc1": "Durable Sessions keep your remote terminal alive through disconnects, computer sleep, and restarts. They automatically reconnect when you're back.",
            "desc2": "Your shell state, running programs, and history survive disconnects. Durable Sessions reconnect automatically.",
            "desc3": "No special setup required. Just enable durable sessions for any SSH connection in Wave.",
            "desc4": "Works with your existing SSH keys and configs. No server-side changes needed.",
            "desc5": "See the docs for more details on configuration and advanced usage.",
        },
        "starask": {
            "title": "Support open-source. Star Wave. ⭐",
            "desc": "Wave is free, open-source, and open-model. Stars help us stay visible against closed alternatives. One click makes a difference.",
        },
    },
    "zh-CN": {
        "durable": {
            "title": "持久会话",
            "protectedBadge": "已保护",
            "desc1": "持久会话让你的远程终端在网络中断、电脑休眠和重启后仍然保持存活。当你重新连接时，它会自动恢复。",
            "desc2": "你的 Shell 状态、正在运行的程序和历史记录在断开后依然保留。持久会话会自动重新连接。",
            "desc3": "无需特殊设置。只需在 Wave 中为任何 SSH 连接启用持久会话即可。",
            "desc4": "与你现有的 SSH 密钥和配置兼容。无需服务端更改。",
            "desc5": "查看文档了解配置和高级用法的更多细节。",
        },
        "starask": {
            "title": "支持开源，为 Wave 加星 ⭐",
            "desc": "Wave 是免费、开源、开放模型的。星星能帮助我们保持可见度，对抗封闭的替代方案。一键点击，意义非凡。",
        },
    },
}

for lang, data in DATA.items():
    for fpath in [f"locales/{lang}/translation.json", f"public/locales/{lang}/translation.json"]:
        import os
        if not os.path.exists(fpath):
            continue
        with open(fpath, encoding="utf-8") as f:
            d = json.load(f)
        ob = d["onboarding"]
        for k, v in data.items():
            ob[k] = v
        with open(fpath, "w", encoding="utf-8") as f:
            json.dump(d, f, ensure_ascii=False, indent=2)
        print(f"✅ {fpath}")

# 验证
for lang in ["en", "zh-CN"]:
    with open(f"locales/{lang}/translation.json", encoding="utf-8") as f:
        json.load(f)
    print(f"✅ {lang} JSON 合法")