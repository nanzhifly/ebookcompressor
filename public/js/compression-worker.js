// 导入必要的库
importScripts('/js/lib/pdf-lib.min.js');
importScripts('/js/lib/comlink.min.js');

// 图像处理器
const ImageProcessor = {
    // 创建 Canvas
    async createCanvas(width, height) {
        const canvas = new OffscreenCanvas(width, height);
        const ctx = canvas.getContext('2d');
        return { canvas, ctx };
    },
    
    // 压缩图像
    async compress(imageData, settings) {
        try {
            // 创建 Canvas
            const { canvas, ctx } = await this.createCanvas(imageData.width, imageData.height);
            
            // 将图像数据绘制到 Canvas
            ctx.putImageData(imageData, 0, 0);
            
            // 计算新的尺寸
            let newWidth = imageData.width;
            let newHeight = imageData.height;
            
            if (newWidth > settings.maxImageSize || newHeight > settings.maxImageSize) {
                const ratio = Math.min(settings.maxImageSize / newWidth, settings.maxImageSize / newHeight);
                newWidth = Math.floor(newWidth * ratio);
                newHeight = Math.floor(newHeight * ratio);
                
                // 创建临时 canvas 进行缩放
                const { canvas: tempCanvas, ctx: tempCtx } = await this.createCanvas(newWidth, newHeight);
                tempCtx.drawImage(canvas, 0, 0, newWidth, newHeight);
                canvas.width = newWidth;
                canvas.height = newHeight;
                ctx.drawImage(tempCanvas, 0, 0);
            }
            
            // 应用颜色空间转换
            if (settings.colorSpace === 'DeviceGray') {
                const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                const data = imageData.data;
                
                // 转换为灰度
                for (let i = 0; i < data.length; i += 4) {
                    const gray = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114);
                    data[i] = gray;
                    data[i + 1] = gray;
                    data[i + 2] = gray;
                }
                
                ctx.putImageData(imageData, 0, 0);
            }
            
            // 获取压缩后的数据
            const blob = await canvas.convertToBlob({
                type: 'image/jpeg',
                quality: settings.imageQuality
            });
            
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
        imageQuality: 0.3,         // 更激进的压缩
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
        const pdfDoc = await PDFLib.PDFDocument.load(arrayBuffer);
        
        // 获取压缩设置
        const settings = compressionSettings[compressionLevel] || compressionSettings.medium;
        
        // 创建新的 PDF 文档
        const newPdfDoc = await PDFLib.PDFDocument.create();
        
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
            
            // 复制页面
            const [copiedPage] = await newPdfDoc.copyPages(pdfDoc, [i]);
            
            // 处理页面中的图像
            if (settings.compressImages) {
                try {
                    const pageDict = copiedPage.node;
                    const resources = pageDict.Resources;
                    
                    if (resources && resources.XObject) {
                        const xObjects = resources.XObject.dict;
                        
                        for (const [name, xObject] of Object.entries(xObjects)) {
                            try {
                                if (xObject instanceof PDFLib.PDFImage) {
                                    // 获取图像数据
                                    const imageData = await xObject.embedIntoContext();
                                    const width = xObject.width || xObject.Size[0];
                                    const height = xObject.height || xObject.Size[1];
                                    
                                    // 创建 ImageData 对象
                                    const imgData = new ImageData(
                                        new Uint8ClampedArray(imageData),
                                        width,
                                        height
                                    );
                                    
                                    // 压缩图像
                                    const compressedData = await ImageProcessor.compress(imgData, settings);
                                    
                                    if (compressedData) {
                                        // 嵌入压缩后的图像
                                        const compressedImage = await newPdfDoc.embedJpg(compressedData);
                                        xObjects[name] = compressedImage.ref;
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
        
        // 保存压缩后的 PDF
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