// 导入必要的库
importScripts('/js/lib/pdf-lib.min.js');
importScripts('/js/lib/comlink.min.js');
importScripts('/js/lib/browser-image-compression.min.js');

// 图像处理器
const ImageProcessor = {
    // 创建 Canvas
    async createCanvas(width, height) {
        const canvas = new OffscreenCanvas(width, height);
        const ctx = canvas.getContext('2d');
        return { canvas, ctx };
    },
    
    // 加载图像
    async loadImage(data) {
        return await createImageBitmap(new Blob([data]));
    },
    
    // 应用压缩设置
    async compress(imageData, settings) {
        try {
            // 创建图像
            const img = await this.loadImage(imageData);
            
            // 计算新尺寸
            let width = img.width;
            let height = img.height;
            
            if (width > settings.maxImageSize || height > settings.maxImageSize) {
                const ratio = Math.min(settings.maxImageSize / width, settings.maxImageSize / height);
                width = Math.floor(width * ratio);
                height = Math.floor(height * ratio);
            }
            
            // 创建 Canvas
            const { canvas, ctx } = await this.createCanvas(width, height);
            
            // 应用颜色空间转换
            if (settings.colorSpace === 'DeviceGray') {
                ctx.filter = 'grayscale(100%)';
            }
            
            // 绘制图像
            ctx.drawImage(img, 0, 0, width, height);
            
            // 获取压缩后的数据
            const blob = await canvas.convertToBlob({
                type: 'image/jpeg',
                quality: settings.imageQuality
            });
            
            // 清理资源
            img.close();
            
            return new Uint8Array(await blob.arrayBuffer());
        } catch (error) {
            console.error('图像压缩失败:', error);
            return null;
        }
    }
};

// 压缩设置
const compressionSettings = {
    'low': {
        imageQuality: 0.8,         // 图像质量 (0-1)
        compressImages: true,      // 是否压缩图像
        removeMetadata: false,     // 是否移除元数据
        maxImageSize: 2048,        // 最大图像尺寸
        colorSpace: 'RGB',         // 颜色空间
        dpi: 150                   // 图像分辨率
    },
    'medium': {
        imageQuality: 0.6,
        compressImages: true,
        removeMetadata: true,
        maxImageSize: 1600,
        colorSpace: 'RGB',
        dpi: 120
    },
    'high': {
        imageQuality: 0.4,
        compressImages: true,
        removeMetadata: true,
        maxImageSize: 1200,
        colorSpace: 'DeviceGray',  // 转换为灰度以获得更高压缩率
        dpi: 96
    }
};

// PDF 压缩函数
async function compressPDF(arrayBuffer, compressionLevel = 'medium') {
    try {
        // 从 ArrayBuffer 加载 PDF
        const pdfDoc = await PDFLib.PDFDocument.load(arrayBuffer, {
            updateMetadata: false
        });
        
        // 获取压缩设置
        const settings = compressionSettings[compressionLevel] || compressionSettings.medium;
        
        // 获取页面数量
        const pageCount = pdfDoc.getPageCount();
        
        // 创建新的 PDF 文档
        const newPdfDoc = await PDFLib.PDFDocument.create();
        
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
            
            // 处理页面中的图像
            if (settings.compressImages) {
                try {
                    // 获取页面对象
                    const pageObj = copiedPage.node;
                    const resources = pageObj.Resources;
                    
                    // 处理图像对象
                    if (resources && resources.XObject) {
                        const xObjects = resources.XObject.dict;
                        
                        for (const [name, xObject] of Object.entries(xObjects)) {
                            try {
                                // 检查是否为图像
                                if (xObject.Subtype === 'Image') {
                                    // 获取图像数据
                                    const imageData = await xObject.getImageData();
                                    
                                    if (imageData) {
                                        // 压缩图像
                                        const compressedData = await ImageProcessor.compress(
                                            imageData,
                                            settings
                                        );
                                        
                                        if (compressedData) {
                                            // 创建新的图像对象
                                            const compressedImage = await newPdfDoc.embedJpg(compressedData);
                                            
                                            // 替换原始图像
                                            xObjects[name] = compressedImage.ref;
                                        }
                                    }
                                }
                            } catch (error) {
                                console.error('处理单个图像时出错:', error);
                            }
                        }
                    }
                } catch (error) {
                    console.error('处理页面图像时出错:', error);
                }
            }
            
            // 添加处理后的页面
            newPdfDoc.addPage(copiedPage);
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
        
        // 保存压缩后的 PDF，使用最高压缩设置
        const compressedPdfBytes = await newPdfDoc.save({
            useObjectStreams: true,
            addDefaultPage: false,
            useCompression: true,
            objectsPerTick: 50,
            updateFieldAppearances: false,
            preserveFormatting: false
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