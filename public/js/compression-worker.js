// 导入必要的库
importScripts('/js/lib/pdf-lib.min.js');
importScripts('/js/lib/comlink.min.js');
importScripts('/js/lib/browser-image-compression.min.js');

// 压缩设置
const compressionSettings = {
    'low': {
        imageQuality: 0.8,         // 图像质量 (0-1)
        compressImages: true,      // 是否压缩图像
        removeMetadata: false,     // 是否移除元数据
        imageResolution: 150,      // 图像分辨率 DPI
        compressStreams: true,     // 压缩对象流
        preserveFormatting: true,  // 保留格式
        maxImageSize: 2048,        // 最大图像尺寸
        convertToJPG: true        // 始终转换为 JPG 以获得更好的压缩率
    },
    'medium': {
        imageQuality: 0.6,
        compressImages: true,
        removeMetadata: true,
        imageResolution: 120,
        compressStreams: true,
        preserveFormatting: false,
        maxImageSize: 1600,
        convertToJPG: true
    },
    'high': {
        imageQuality: 0.4,
        compressImages: true,
        removeMetadata: true,
        imageResolution: 96,
        compressStreams: true,
        preserveFormatting: false,
        maxImageSize: 1200,
        convertToJPG: true
    }
};

// PDF 压缩函数
async function compressPDF(arrayBuffer, compressionLevel = 'medium') {
    try {
        // 从 ArrayBuffer 加载 PDF
        const pdfDoc = await PDFLib.PDFDocument.load(arrayBuffer);
        
        // 创建新的 PDF 文档
        const newPdfDoc = await PDFLib.PDFDocument.create();
        
        // 获取压缩设置
        const settings = compressionSettings[compressionLevel] || compressionSettings.medium;
        
        // 获取页面数量
        const pageCount = pdfDoc.getPageCount();
        
        // 处理每一页
        for (let i = 0; i < pageCount; i++) {
            // 发送进度信息
            postMessage({
                type: 'progress',
                progress: (i / pageCount) * 100,
                message: `正在处理第 ${i + 1} 页，共 ${pageCount} 页...`
            });
            
            // 复制页面到新文档
            const [copiedPage] = await newPdfDoc.copyPages(pdfDoc, [i]);
            newPdfDoc.addPage(copiedPage);
            
            // 获取原始页面
            const page = pdfDoc.getPage(i);
            
            // 如果需要压缩图像
            if (settings.compressImages) {
                try {
                    // 获取页面上的所有图像
                    const images = await page.getImages();
                    
                    for (const image of images) {
                        try {
                            // 获取图像数据
                            const imageData = await image.getData();
                            const width = image.getWidth();
                            const height = image.getHeight();
                            
                            // 计算新的尺寸
                            let newWidth = width;
                            let newHeight = height;
                            
                            if (width > settings.maxImageSize || height > settings.maxImageSize) {
                                const ratio = Math.min(settings.maxImageSize / width, settings.maxImageSize / height);
                                newWidth = Math.floor(width * ratio);
                                newHeight = Math.floor(height * ratio);
                            }
                            
                            // 创建 Canvas
                            const canvas = new OffscreenCanvas(newWidth, newHeight);
                            const ctx = canvas.getContext('2d');
                            
                            // 创建 ImageBitmap
                            const imageBitmap = await createImageBitmap(
                                new Blob([imageData], { type: 'image/png' })
                            );
                            
                            // 绘制图像到 Canvas
                            ctx.drawImage(imageBitmap, 0, 0, newWidth, newHeight);
                            
                            // 获取压缩后的图像数据
                            const blob = await canvas.convertToBlob({
                                type: 'image/jpeg',
                                quality: settings.imageQuality
                            });
                            
                            // 将压缩后的图像嵌入到 PDF
                            const compressedImage = await PDFLib.PDFDocument.embedJpg(
                                await blob.arrayBuffer()
                            );
                            
                            // 替换原始图像
                            const imageName = Object.keys(page.node.Resources.XObject.dict)
                                .find(key => page.node.Resources.XObject.dict[key] === image);
                                
                            if (imageName) {
                                page.node.Resources.XObject.dict[imageName] = compressedImage;
                            }
                            
                            // 清理资源
                            imageBitmap.close();
                        } catch (error) {
                            console.error('处理单个图像时出错:', error);
                        }
                    }
                } catch (error) {
                    console.error('处理页面图像时出错:', error);
                }
            }
        }
        
        // 如果需要移除元数据
        if (settings.removeMetadata) {
            newPdfDoc.setTitle('');
            newPdfDoc.setAuthor('');
            newPdfDoc.setSubject('');
            newPdfDoc.setKeywords([]);
            newPdfDoc.setProducer('');
            newPdfDoc.setCreator('');
        }
        
        // 保存压缩后的 PDF
        const compressedPdfBytes = await newPdfDoc.save({
            useObjectStreams: settings.compressStreams,
            addDefaultPage: false,
            useCompression: true,
            preserveFormatting: settings.preserveFormatting
        });
        
        return compressedPdfBytes;
    } catch (error) {
        throw new Error(`PDF 压缩失败: ${error.message}`);
    }
}

// EPUB 压缩函数
async function compressEPUB(arrayBuffer, compressionLevel = 'medium') {
    // TODO: 实现 EPUB 压缩
    throw new Error('EPUB 压缩功能尚未在客户端模式下实现');
}

// 导出压缩函数
const compression = {
    async compressFile(file, compressionLevel) {
        try {
            // 读取文件内容
            const arrayBuffer = await file.arrayBuffer();
            
            // 根据文件类型选择压缩方法
            if (file.name.toLowerCase().endsWith('.pdf')) {
                return await compressPDF(arrayBuffer, compressionLevel);
            } else if (file.name.toLowerCase().endsWith('.epub')) {
                return await compressEPUB(arrayBuffer, compressionLevel);
            } else {
                throw new Error('不支持的文件类型');
            }
        } catch (error) {
            throw error;
        }
    }
};

// 使用 Comlink 暴露接口
Comlink.expose(compression); 