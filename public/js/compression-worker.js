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
            
            // 获取原始页面
            const page = pdfDoc.getPage(i);
            
            // 提取页面上的所有图像
            const imageIndices = await extractPageImageIndices(page);
            
            // 复制页面到新文档
            const [copiedPage] = await newPdfDoc.copyPages(pdfDoc, [i]);
            newPdfDoc.addPage(copiedPage);
            
            // 如果需要压缩图像
            if (settings.compressImages && imageIndices.length > 0) {
                for (const index of imageIndices) {
                    try {
                        // 获取图像对象
                        const image = await page.getImage(index);
                        
                        if (image) {
                            // 压缩图像
                            const compressedImage = await compressImage(image, settings);
                            
                            if (compressedImage) {
                                // 替换图像
                                await replacePageImage(copiedPage, index, compressedImage);
                            }
                        }
                    } catch (error) {
                        console.error(`处理图像 ${index} 时出错:`, error);
                    }
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

// 提取页面中的图像索引
async function extractPageImageIndices(page) {
    const indices = [];
    try {
        // 获取页面的操作列表
        const operatorList = await page.getOperatorList();
        
        // 遍历操作列表查找图像
        for (let i = 0; i < operatorList.fnArray.length; i++) {
            if (operatorList.fnArray[i] === PDFLib.OPS.paintImageXObject) {
                const imageIndex = operatorList.argsArray[i][0];
                if (imageIndex && !indices.includes(imageIndex)) {
                    indices.push(imageIndex);
                }
            }
        }
    } catch (error) {
        console.error('提取图像索引时出错:', error);
    }
    return indices;
}

// 压缩图像
async function compressImage(image, settings) {
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
        
        // 创建缩放后的图像数据
        const scaledData = await resizeImageData(imageData, width, height, newWidth, newHeight);
        
        // 根据设置选择输出格式
        if (settings.convertToJPG) {
            return await PDFLib.PDFDocument.embedJpg(scaledData);
        } else {
            return await PDFLib.PDFDocument.embedPng(scaledData);
        }
    } catch (error) {
        console.error('压缩图像时出错:', error);
        return null;
    }
}

// 调整图像大小
async function resizeImageData(data, oldWidth, oldHeight, newWidth, newHeight) {
    // 创建原始图像数据数组
    const sourceData = new Uint8ClampedArray(data);
    const targetData = new Uint8ClampedArray(newWidth * newHeight * 4);
    
    // 计算缩放比例
    const xRatio = oldWidth / newWidth;
    const yRatio = oldHeight / newHeight;
    
    // 双线性插值算法
    for (let y = 0; y < newHeight; y++) {
        for (let x = 0; x < newWidth; x++) {
            const px = Math.floor(x * xRatio);
            const py = Math.floor(y * yRatio);
            
            const targetIndex = (y * newWidth + x) * 4;
            const sourceIndex = (py * oldWidth + px) * 4;
            
            targetData[targetIndex] = sourceData[sourceIndex];         // R
            targetData[targetIndex + 1] = sourceData[sourceIndex + 1]; // G
            targetData[targetIndex + 2] = sourceData[sourceIndex + 2]; // B
            targetData[targetIndex + 3] = sourceData[sourceIndex + 3]; // A
        }
    }
    
    return targetData;
}

// 替换页面中的图像
async function replacePageImage(page, imageIndex, newImage) {
    try {
        if (page && newImage) {
            // 获取页面的资源字典
            const resources = page.getResources();
            
            // 更新图像资源
            resources.updateImage(imageIndex, newImage);
        }
    } catch (error) {
        console.error('替换图像时出错:', error);
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