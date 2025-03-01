// 导入必要的库
importScripts('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js');
importScripts('/js/lib/pdf-lib.min.js');
importScripts('/js/lib/comlink.min.js');
importScripts('/js/lib/browser-image-compression.min.js');

// 初始化 PDF.js
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// 图像处理器
const ImageProcessor = {
    // 创建 Canvas
    async createCanvas(width, height) {
        const canvas = new OffscreenCanvas(width, height);
        const ctx = canvas.getContext('2d');
        return { canvas, ctx };
    },
    
    // 压缩图像
    async compress(imageData, width, height, settings) {
        try {
            // 创建 Canvas
            const { canvas, ctx } = await this.createCanvas(width, height);
            
            // 创建 ImageData
            const imgData = new ImageData(
                new Uint8ClampedArray(imageData),
                width,
                height
            );
            
            // 将 ImageData 绘制到 Canvas
            ctx.putImageData(imgData, 0, 0);
            
            // 应用颜色空间转换
            if (settings.colorSpace === 'DeviceGray') {
                // 创建临时 canvas 进行灰度转换
                const { canvas: tempCanvas, ctx: tempCtx } = await this.createCanvas(width, height);
                tempCtx.filter = 'grayscale(100%)';
                tempCtx.drawImage(canvas, 0, 0);
                
                // 更新主 canvas
                ctx.clearRect(0, 0, width, height);
                ctx.drawImage(tempCanvas, 0, 0);
            }
            
            // 计算新的尺寸
            let newWidth = width;
            let newHeight = height;
            
            if (width > settings.maxImageSize || height > settings.maxImageSize) {
                const ratio = Math.min(settings.maxImageSize / width, settings.maxImageSize / height);
                newWidth = Math.floor(width * ratio);
                newHeight = Math.floor(height * ratio);
                
                // 创建临时 canvas 进行缩放
                const { canvas: tempCanvas, ctx: tempCtx } = await this.createCanvas(newWidth, newHeight);
                tempCtx.drawImage(canvas, 0, 0, newWidth, newHeight);
                
                // 更新主 canvas
                canvas.width = newWidth;
                canvas.height = newHeight;
                ctx.drawImage(tempCanvas, 0, 0);
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
        // 加载 PDF 文档
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        const settings = compressionSettings[compressionLevel] || compressionSettings.medium;
        
        // 创建新的 PDF 文档
        const newPdfDoc = await PDFLib.PDFDocument.create();
        
        // 处理每一页
        for (let i = 0; i < pdf.numPages; i++) {
            // 发送进度信息
            postMessage({
                type: 'progress',
                progress: (i / pdf.numPages) * 100,
                message: `正在处理第 ${i + 1} 页，共 ${pdf.numPages} 页...`
            });
            
            // 获取页面
            const page = await pdf.getPage(i + 1);
            const ops = await page.getOperatorList();
            
            // 创建新页面
            const [newPage] = await newPdfDoc.addPage([
                page.view[2],  // width
                page.view[3]   // height
            ]);
            
            // 处理页面内容
            for (let j = 0; j < ops.fnArray.length; j++) {
                const fn = ops.fnArray[j];
                const args = ops.argsArray[j];
                
                // 检查是否为图像操作
                if (fn === pdfjsLib.OPS.paintImageXObject) {
                    const imageRef = args[0];
                    
                    try {
                        // 获取图像数据
                        const img = await page.objs.get(imageRef);
                        
                        if (img && img.data) {
                            // 压缩图像
                            const compressedData = await ImageProcessor.compress(
                                img.data,
                                img.width,
                                img.height,
                                settings
                            );
                            
                            if (compressedData) {
                                // 嵌入压缩后的图像
                                const image = await newPdfDoc.embedJpg(compressedData);
                                
                                // 在新页面中绘制图像
                                newPage.drawImage(image, {
                                    x: args[1],
                                    y: args[2],
                                    width: args[3],
                                    height: args[4]
                                });
                            }
                        }
                    } catch (error) {
                        console.error('处理图像时出错:', error);
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