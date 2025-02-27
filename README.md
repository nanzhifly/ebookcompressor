# Compress EPUB

一个简单的 EPUB 电子书压缩工具。

## 功能特性

- EPUB 文件压缩
- 三种压缩级别：低、中、高
- 拖拽上传
- 实时压缩进度显示

## 技术栈

- Frontend: HTML, CSS, JavaScript
- Backend: Node.js, Express
- PDF Processing: Ghostscript
- EPUB Processing: adm-zip

## 开发日志

### 2024-03-xx
- 初始版本发布
- 实现基本的文件上传和压缩功能

### 2024-03-xx
- 优化 PDF 压缩算法
- 添加详细的日志记录
- 改进错误处理机制

## 待优化项目

- [ ] 优化 PDF 压缩效果
- [ ] 添加压缩预览功能
- [ ] 支持批量文件处理
- [ ] 添加文件完整性验证

## 技术文档

### 技术栈
- 前端：HTML, CSS, JavaScript
- 后端：Node.js
- 文件处理：Ghostscript (PDF处理), epub-compressor (EPUB处理)

### 项目结构 

## 问题记录与解决方案

### PDF 压缩级别问题

**问题描述：**
- Low 压缩级别导致文件变大（39.04 MB → 43.76 MB）
- Medium 和 High 级别工作正常

**原因分析：**
1. 默认的 `/default` 和 `/prepress` 设置保留了过多原始数据
2. 高分辨率（300dpi）导致某些元素被重新渲染为更高质量
3. 某些参数组合导致文件膨胀而不是压缩

**解决方案：**
使用以下参数组合成功解决：
1. Low 级别：
   - 使用 `/printer` 设置
   - 分辨率设为 150dpi
   - 禁用缩略图
   - 不压缩字体
   - 保留标记内容
   最终效果：37% 压缩率（39.04MB → 24.59MB）

2. Medium 级别：
   - 使用 `/ebook` 设置
   - 分辨率设为 120dpi

3. High 级别：
   - 使用 `/screen` 设置
   - 分辨率设为 72dpi

**经验总结：**
1. PDF 压缩需要平衡质量和大小
2. 不同的 Ghostscript 参数组合会产生显著不同的结果
3. 某些参数可能会意外增加文件大小
4. 测试不同参数组合很重要 

## 开发计划

### 1. 压缩预览功能 (优先级：高)
- [ ] 压缩前预览效果
- [ ] 不同压缩级别的对比预览
- [ ] 预览页面的缩放和翻页
- [ ] 实时质量对比功能

### 2. EPUB 格式支持 (优先级：高)
- [ ] EPUB 文件解析和处理
- [ ] 图片资源压缩
- [ ] CSS 和 HTML 文件优化
- [ ] 保持电子书格式和目录结构
- [ ] EPUB 文件完整性验证

### 3. 批量文件处理 (优先级：中)
- [ ] 多文件同时上传
- [ ] 批量压缩队列
- [ ] 进度显示和管理
- [ ] 批量下载功能
- [ ] 失败任务重试机制

### 4. 压缩历史记录 (优先级：中)
- [ ] 本地存储压缩历史
- [ ] 显示历史压缩结果
- [ ] 重用历史压缩设置
- [ ] 历史记录管理（删除/导出）

### 5. 文件完整性验证 (优先级：低)
- [ ] 压缩前后的文件校验
- [ ] MD5/SHA256 校验和比对
- [ ] PDF 结构完整性检查
- [ ] 错误检测和报告
- [ ] 自动修复建议

## 开发进度

### 已完成功能
- [x] 基础文件上传
- [x] PDF 压缩（三种级别）
- [x] EPUB 压缩（三种级别）
- [x] 拖拽上传
- [x] 压缩进度显示
- [x] 优化 PDF 压缩参数配置
- [x] EPUB 图片和文本压缩

### 进行中
- [ ] 压缩预览功能开发
- [ ] 批量文件处理

### 待开始
- [ ] 压缩历史记录
- [ ] 文件完整性验证 