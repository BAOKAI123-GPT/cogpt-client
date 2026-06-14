# PixRelay · 设计师生图工作站

让平面设计师**不碰代码**就能用上各种「中转站」的 ChatGPT 生图能力，并内置常用设计工具。

- 填一次「中转站地址 + API Key」，点「扫描模型」→ 自动高亮 gpt 生图模型 → 确认即可。
- 像 ChatGPT 官方客户端一样**对话生图**、多轮连续改图。
- 内置画布编辑器：**局部重绘（框选改图）、抠图、文字层 + 一键换字体、本地放大、降分辨率 / 改尺寸 / 格式转换、图生图、批量处理**。
- 可保存多个中转站，**一键切换**，随时找更便宜可靠的。
- API Key 经系统安全存储**本地加密**保存；图片本地处理，仅提示词 / 图片发往你自己配置的中转站。

## 开发

```bash
npm install
npm run dev        # 开发模式启动
npm run typecheck  # 类型检查
npm run build      # 打包前端（main/preload/renderer）
```

## 打包 Windows 安装包

最省事：在 **Windows 电脑**上执行（自动安装正确的原生依赖）：

```bash
npm install
npm run build:win
# 产物在 dist/：PixRelay-Setup-x.y.z.exe（安装版）与便携版
```

也可以用 **GitHub Actions 云端打包**：把项目推到 GitHub，在 Actions 页面手动运行
`Build installers`，或推送 `v0.1.0` 这样的标签，自动产出安装包（见 `.github/workflows/build.yml`）。

> 在 Linux 上交叉打包 Windows 需要 `wine`（含 32 位支持）以及 Windows 版 sharp 二进制；
> 详见 `.github/workflows/build.yml` 与构建说明。Mac 的 `.dmg` 需在 macOS 上构建。

## 技术栈

Electron · React · TypeScript · Konva（画布）· sharp（本地图像处理）·
@imgly/background-removal（本地抠图）· electron-builder（打包）。
