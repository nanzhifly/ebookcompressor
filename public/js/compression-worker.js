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
        convertToJPG: false        // 是否转换为 JPG
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
        const pdfDoc = await PDFLib.PDFDocument.load(arrayBuffer, {
            updateMetadata: false  // 防止自动更新元数据
        });
        
        // 获取页面数量用于进度计算
        const pageCount = pdfDoc.getPageCount();
        
        // 创建新的 PDF 文档
        const newPdfDoc = await PDFLib.PDFDocument.create();
        
        // 获取压缩设置
        const settings = compressionSettings[compressionLevel] || compressionSettings.medium;
        
        // 复制所有页面到新文档
        for (let i = 0; i < pageCount; i++) {
            // 发送进度信息
            postMessage({
                type: 'progress',
                progress: (i / pageCount) * 100,
                message: `正在处理第 ${i + 1} 页，共 ${pageCount} 页...`
            });
            
            // 复制页面
            const [copiedPage] = await newPdfDoc.copyPages(pdfDoc, [i]);
            newPdfDoc.addPage(copiedPage);
            
            // 处理页面中的图像
            if (settings.compressImages) {
                try {
                    const images = await extractImagesFromPage(pdfDoc.getPage(i));
                    for (const image of images) {
                        try {
                            const compressedImage = await compressImage(image.ref, settings);
                            if (compressedImage) {
                                await embedCompressedImage(newPdfDoc, copiedPage, image.index, compressedImage);
                            }
                        } catch (error) {
                            console.error('图像压缩错误:', error);
                        }
                    }
                } catch (error) {
                    console.error('页面图像处理错误:', error);
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

// 从页面提取图像
async function extractImagesFromPage(page) {
    const images = [];
    try {
        // 获取页面上的所有图像对象
        const imageObjects = await page.getImages();
        
        for (let i = 0; i < imageObjects.length; i++) {
            const img = imageObjects[i];
            images.push({
                ref: img,
                index: i
            });
        }
    } catch (error) {
        console.error('提取图像错误:', error);
    }
    return images;
}

// 压缩图像
async function compressImage(imageRef, settings) {
    try {
        // 获取图像数据
        const image = await imageRef.getData();
        const width = imageRef.getWidth();
        const height = imageRef.getHeight();
        
        // 计算新的尺寸
        const maxSize = settings.maxImageSize;
        let newWidth = width;
        let newHeight = height;
        
        if (width > maxSize || height > maxSize) {
            if (width > height) {
                newWidth = maxSize;
                newHeight = Math.round(height * (maxSize / width));
            } else {
                newHeight = maxSize;
                newWidth = Math.round(width * (maxSize / height));
            }
        }
        
        // 创建压缩选项
        const options = {
            maxSizeMB: 2,
            maxWidthOrHeight: maxSize,
            useWebWorker: false,  // 在 Worker 中不能再使用 Worker
            fileType: settings.convertToJPG ? 'image/jpeg' : 'image/png',
            initialQuality: settings.imageQuality
        };
        
        // 压缩图像
        const compressedData = await imageCompression(
            new Blob([image], { type: 'image/png' }),
            options
        );
        
        return new Uint8Array(await compressedData.arrayBuffer());
    } catch (error) {
        console.error('图像压缩错误:', error);
        return null;
    }
}

// 将压缩后的图像嵌入 PDF
async function embedCompressedImage(pdfDoc, page, index, imageData) {
    try {
        let image;
        if (imageData) {
            image = await pdfDoc.embedPng(imageData);
            // 在页面中替换图像
            // TODO: 实现图像替换逻辑
        }
    } catch (error) {
        console.error('嵌入图像错误:', error);
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