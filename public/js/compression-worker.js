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
            
            // 获取原始页面
            const page = pdfDoc.getPage(i);
            
            // 获取页面上的所有图像
            const imageObjects = await page.getImages();
            
            // 创建压缩后的图像映射
            const compressedImages = new Map();
            
            // 压缩所有图像
            if (settings.compressImages && imageObjects.length > 0) {
                for (const img of imageObjects) {
                    try {
                        // 获取图像引用
                        const ref = img.ref;
                        
                        // 获取图像数据
                        const image = await pdfDoc.embedJpg(await img.getData());
                        
                        // 获取图像尺寸
                        const width = image.width;
                        const height = image.height;
                        
                        // 计算新的尺寸
                        let newWidth = width;
                        let newHeight = height;
                        
                        if (width > settings.maxImageSize || height > settings.maxImageSize) {
                            const ratio = Math.min(settings.maxImageSize / width, settings.maxImageSize / height);
                            newWidth = Math.floor(width * ratio);
                            newHeight = Math.floor(height * ratio);
                        }
                        
                        // 创建压缩后的图像
                        const compressedImage = await PDFLib.PDFDocument.embedJpg(
                            await image.scaleToFit(newWidth, newHeight).getData()
                        );
                        
                        // 存储压缩后的图像
                        compressedImages.set(ref, compressedImage);
                    } catch (error) {
                        console.error('处理图像时出错:', error);
                    }
                }
            }
            
            // 复制页面到新文档，同时替换图像
            const [copiedPage] = await newPdfDoc.copyPages(pdfDoc, [i]);
            
            // 替换页面中的图像
            if (compressedImages.size > 0) {
                const pageDict = copiedPage.node;
                const resources = pageDict.Resources;
                
                if (resources && resources.XObject) {
                    Object.entries(resources.XObject.dict).forEach(([name, xObject]) => {
                        const compressed = compressedImages.get(xObject);
                        if (compressed) {
                            resources.XObject.dict[name] = compressed;
                        }
                    });
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