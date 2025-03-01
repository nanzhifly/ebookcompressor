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
            
            // 处理页面中的图像
            if (settings.compressImages) {
                try {
                    // 提取页面中的图像
                    const images = await extractImagesFromPage(pdfDoc, i);
                    
                    // 压缩每个图像
                    for (const image of images) {
                        const compressedImage = await compressImage(image, settings);
                        if (compressedImage) {
                            // 替换原图像
                            await replacePageImage(copiedPage, image.index, compressedImage);
                        }
                    }
                } catch (error) {
                    console.error('图像处理错误:', error);
                }
            }
            
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
async function extractImagesFromPage(pdfDoc, pageIndex) {
    const page = pdfDoc.getPages()[pageIndex];
    const images = [];
    
    try {
        // 获取页面的操作对象
        const ops = await page.getOperatorList();
        let imageIndex = 0;
        
        // 遍历操作找到图像
        for (let i = 0; i < ops.fnArray.length; i++) {
            if (ops.fnArray[i] === PDFLib.OPS.paintImageXObject) {
                const imageRef = ops.argsArray[i][0];
                if (imageRef) {
                    const image = page.getImage(imageRef);
                    if (image) {
                        images.push({
                            index: imageIndex++,
                            data: image.data,
                            width: image.width,
                            height: image.height
                        });
                    }
                }
            }
        }
    } catch (error) {
        console.error('提取图像错误:', error);
    }
    
    return images;
}

// 压缩图像
async function compressImage(image, settings) {
    try {
        // 创建 canvas 来处理图像
        const canvas = new OffscreenCanvas(image.width, image.height);
        const ctx = canvas.getContext('2d');
        
        // 将图像数据绘制到 canvas
        const imageData = new ImageData(
            new Uint8ClampedArray(image.data),
            image.width,
            image.height
        );
        ctx.putImageData(imageData, 0, 0);
        
        // 获取 blob
        const blob = await canvas.convertToBlob({
            type: settings.convertToJPG ? 'image/jpeg' : 'image/png',
            quality: settings.imageQuality
        });
        
        // 使用 browser-image-compression 压缩
        const compressedBlob = await imageCompression(blob, {
            maxSizeMB: 1,
            maxWidthOrHeight: settings.maxImageSize,
            useWebWorker: true,
            fileType: settings.convertToJPG ? 'image/jpeg' : 'image/png'
        });
        
        // 转换回 ArrayBuffer
        return await compressedBlob.arrayBuffer();
    } catch (error) {
        console.error('图像压缩错误:', error);
        return null;
    }
}

// 替换页面中的图像
async function replacePageImage(page, imageIndex, compressedImageData) {
    try {
        // 创建新的 PDFImage
        const image = await PDFLib.PDFImage.create(page.doc, compressedImageData);
        
        // 替换原图像
        page.node.setImage(imageIndex, image);
    } catch (error) {
        console.error('替换图像错误:', error);
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