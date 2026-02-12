# Linux 构建与安装（WaveCN）

本文用于在 Linux 上从源码构建/打包本仓库（`waveterm-zhcn` / WaveCN），并整理常用安装命令。

更完整的依赖列表与打包依赖说明，请以仓库根目录的 `BUILD.md` 为准（尤其是 snapcraft/lxd/squashfs-tools 等）。

## 一键安装（Ubuntu/Debian，推荐）

从 GitHub Releases 下载并安装最新版本（默认优先 `.deb`，找不到会回退到 `.AppImage`）：

```bash
curl -fsSL https://raw.githubusercontent.com/stevenwang288/waveterm/master/scripts/install-ubuntu.sh | bash
```

仅安装最新稳定版（跳过 pre-release）：

```bash
curl -fsSL https://raw.githubusercontent.com/stevenwang288/waveterm/master/scripts/install-ubuntu.sh | bash -s -- --stable
```

## 依赖

- Node.js 22 LTS
- Go（建议 1.22+）
- Task（https://taskfile.dev/installation/）
- Zig（用于 CGO 静态链接）
- `zip`

Debian/Ubuntu（示例）：

```bash
sudo apt-get update
sudo apt-get install -y zip snapd
sudo snap install zig --classic --beta
```

Fedora/RHEL（示例）：

```bash
sudo dnf install -y zip zig
```

Arch（示例）：

```bash
sudo pacman -S zip zig
```

## 拉取与初始化

```bash
git clone https://github.com/stevenwang288/waveterm.git
cd waveterm
task init
```

## 运行

开发（Vite 热更新）：

```bash
task dev
```

生产（不热更）：

```bash
task start
```

## 打包

```bash
task package
```

Linux ARM64（如需系统 fpm）：

```bash
USE_SYSTEM_FPM=1 task package
```

产物默认输出到 `make/`，常见包含 `.AppImage` / `.deb` / `.rpm`。

## 安装命令示例

> 假设你已在当前目录下载/生成了 release 产物。

Ubuntu / Debian（`.deb`）：

```bash
sudo apt-get install -y ./WaveCN-linux-x64-<version>.deb
```

Fedora / RHEL / Rocky / AlmaLinux（`.rpm`）：

```bash
sudo dnf install -y ./WaveCN-linux-x64-<version>.rpm
```

openSUSE（`.rpm`）：

```bash
sudo zypper install -y ./WaveCN-linux-x64-<version>.rpm
```

通用 Linux（AppImage）：

```bash
chmod +x ./WaveCN-linux-x64-<version>.AppImage
./WaveCN-linux-x64-<version>.AppImage
```
