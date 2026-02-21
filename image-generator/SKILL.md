---
name: image-generator
description: 使用 DeerAPI 的 Gemini 3 Pro 模型生成图片。当用户请求生成图片、创建图像、画图、生图、制作插图、设计图标等任务时使用此 Skill。关键词：生图、画图、生成图片、创建图像、AI绘图、图片生成。
---

# Image Generator - AI 图片生成

使用 DeerAPI 的 `gemini-3-pro-image` 模型生成高质量图片。

## 使用方法

当用户请求生成图片时，运行以下脚本：

```bash
python ~/.claude/skills/image-generator/scripts/generate_image.py "图片描述提示词"
```

### 参数说明

- **第一个参数**（必需）：图片描述提示词，支持中英文
- **--output**（可选）：输出文件路径，默认保存到当前目录
- **--filename**（可选）：文件名，默认使用时间戳命名

### 示例

```bash
# 基础用法
python ~/.claude/skills/image-generator/scripts/generate_image.py "一只可爱的橘猫在阳光下打盹"

# 指定输出目录
python ~/.claude/skills/image-generator/scripts/generate_image.py "科幻风格的未来城市" --output ./images

# 指定文件名
python ~/.claude/skills/image-generator/scripts/generate_image.py "水彩风格的山水画" --filename landscape.png
```

## 提示词优化建议

为获得最佳效果，提示词应包含：

1. **主体**：描述图片的主要内容
2. **风格**：如写实、卡通、水彩、油画、3D渲染等
3. **氛围**：如温馨、科幻、神秘、明亮等
4. **细节**：颜色、光线、构图等

### 优秀提示词示例

```
"一位身穿汉服的少女站在樱花树下，春日暖阳，花瓣飘落，写实摄影风格，柔和的自然光"

"赛博朋克风格的东京街头，霓虹灯闪烁，雨夜，电影画面感，高对比度"

"极简主义风格的 Logo 设计，一只抽象的凤凰，金色和红色渐变，白色背景"
```

## 输出说明

- 脚本会返回生成图片的本地保存路径
- 图片格式为 PNG
- 如果生成失败，会返回具体错误信息

## 环境要求

- Python 3.8+
- requests 库（`pip install requests`）
- 需要设置环境变量 `DEERAPI_KEY`，或在 `~/.claude/skills/image-generator/.env` 中配置

## 错误处理

| 错误信息 | 可能原因 | 解决方案 |
|---------|---------|---------|
| API key not found | 未配置 API Key | 设置 DEERAPI_KEY 环境变量 |
| Request timeout | 网络问题或请求超时 | 重试或检查网络 |
| Invalid prompt | 提示词不合规 | 修改提示词内容 |
| Rate limit exceeded | 请求过于频繁 | 稍后重试 |
