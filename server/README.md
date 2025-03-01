# PDF 压缩服务器

这是一个使用 Ghostscript 进行 PDF 压缩的服务器端应用程序。

## 系统要求

- Node.js 14+
- Ghostscript

## 安装 Ghostscript

### macOS
```bash
brew install ghostscript
```

### Ubuntu/Debian
```bash
sudo apt-get update
sudo apt-get install ghostscript
```

### Windows
从 Ghostscript 官网下载安装程序：https://www.ghostscript.com/releases/gsdnld.html

## 安装依赖

```bash
npm install
```

## 运行服务器

开发模式：
```bash
npm run dev
```

生产模式：
```bash
npm start
```

## API 接口

### POST /compress

压缩 PDF 文件。

请求参数：
- `file`: PDF 文件（multipart/form-data）
- `compressionLevel`: 压缩级别（'low', 'medium', 'high'）

响应格式：
```json
{
    "success": true,
    "data": "base64编码的压缩文件",
    "stats": {
        "originalSize": 1000000,
        "compressedSize": 500000,
        "compressionRatio": "50.00"
    }
}
```

## 压缩级别说明

- `low`: 保持较高质量，适合打印（150dpi）
- `medium`: 平衡质量和大小，适合电子书（120dpi）
- `high`: 最大压缩，适合屏幕显示（72dpi） 