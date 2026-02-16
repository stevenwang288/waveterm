# WAVE 配置 JSON BOM/UTF-16 兼容修复（2026-02-16）

## 现象
- 启动后出现配置错误弹窗/提示：
  - `settings.json: json syntax error at line 1, col 1: invalid character 'ï' looking for beginning of value`
- 进入“配置错误态”后，部分 UI（含朗读按钮/设置页）会表现为灰色、不可用或不生效。

## 根因
- Windows 上某些工具会把 JSON 写成 **UTF-8 with BOM**（文件头 `EF BB BF`）或 **UTF-16**（`FF FE` / `FE FF`）。
- Go 的 `encoding/json` 在解析时不接受 BOM/UTF-16 原始字节流，因此在第 1 个字符处直接报错，导致整份配置加载失败。

典型来源：
- Windows PowerShell 5.1：`Set-Content -Encoding UTF8` 会写入 UTF-8 BOM。

## 修复
- 后端配置读取（Go）增加容错：
  - 兼容 UTF-8 BOM：自动剥离 `EF BB BF`
  - 兼容 UTF-16LE/BE：自动解码为 UTF-8 再解析
  - 位置：`pkg/wconfig/settingsconfig.go`
- 启动阶段读取（Electron main）增加容错：
  - `JSON.parse` 前剥离 `\uFEFF`
  - 位置：`emain/launchsettings.ts`
- Sidecar smoke 脚本避免写入 BOM：
  - 使用 `WriteAllText(..., UTF8Encoding($false))` 输出 UTF-8 no-BOM
  - 位置：`scripts/smoke-waveai-tts-win.ps1`

## 验证
- `go test ./pkg/wconfig` 通过（覆盖 BOM/UTF-16 用例）。
- `task package` 通过。

