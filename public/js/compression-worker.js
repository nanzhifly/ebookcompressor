// 导入必要的库
importScripts('/js/lib/pdf-lib.min.js');
importScripts('/js/lib/comlink.min.js');

// 压缩设置
const compressionSettings = {
    'low': {
        imageQuality: 0.8,
        maxImageSize: 2048,
        colorSpace: 'RGB',
        removeMetadata: false,
        textCompression: false
    },
    'medium': {
        imageQuality: 0.6,
        maxImageSize: 1600,
        colorSpace: 'RGB',
        removeMetadata: true,
        textCompression: true
    },
    'high': {
        imageQuality: 0.3,
        maxImageSize: 1200,
        colorSpace: 'grayscale',
        removeMetadata: true,
        textCompression: true
    }
};

// 图像处理器
class ImageProcessor {
    constructor(settings) {
        this.settings = settings;
    }

    async createCanvas(width, height) {
        const canvas = new OffscreenCanvas(width, height);
        return {
            canvas,
            ctx: canvas.getContext('2d', {
                alpha: false,
                willReadFrequently: true
            })
        };
    }

    async processImage(imageData) {
        try {
            // 创建画布
            const { canvas, ctx } = await this.createCanvas(
                imageData.width,
                imageData.height
            );

            // 绘制原始图像
            ctx.putImageData(imageData, 0, 0);

            // 计算新尺寸
            let newWidth = imageData.width;
            let newHeight = imageData.height;

            if (newWidth > this.settings.maxImageSize || newHeight > this.settings.maxImageSize) {
                const ratio = Math.min(
                    this.settings.maxImageSize / newWidth,
                    this.settings.maxImageSize / newHeight
                );
                newWidth = Math.floor(newWidth * ratio);
                newHeight = Math.floor(newHeight * ratio);
            }

            // 创建临时画布进行缩放
            const { canvas: tempCanvas, ctx: tempCtx } = await this.createCanvas(
                newWidth,
                newHeight
            );

            // 使用双线性插值进行缩放
            tempCtx.imageSmoothingQuality = 'high';
            tempCtx.drawImage(canvas, 0, 0, newWidth, newHeight);

            // 如果需要转换为灰度
            if (this.settings.colorSpace === 'grayscale') {
                const imageData = tempCtx.getImageData(0, 0, newWidth, newHeight);
                const data = imageData.data;

                for (let i = 0; i < data.length; i += 4) {
                    // 使用更精确的灰度转换公式
                    const gray = Math.round(
                        data[i] * 0.299 +
                        data[i + 1] * 0.587 +
                        data[i + 2] * 0.114
                    );
                    data[i] = data[i + 1] = data[i + 2] = gray;
                }

                tempCtx.putImageData(imageData, 0, 0);
            }

            // 转换为压缩后的数据
            const blob = await tempCanvas.convertToBlob({
                type: 'image/jpeg',
                quality: this.settings.imageQuality
            });

            return new Uint8Array(await blob.arrayBuffer());
        } catch (error) {
            console.error('图像处理失败:', error);
            return null;
        }
    }
}

// PDF 压缩器
class PDFCompressor {
    constructor(settings) {
        this.settings = settings;
        this.imageProcessor = new ImageProcessor(settings);
    }

    async compressPDF(arrayBuffer) {
        try {
            // 加载 PDF
            const pdfDoc = await PDFLib.PDFDocument.create();
            const originalDoc = await PDFLib.PDFDocument.load(arrayBuffer);
            
            // 获取页面数量
            const pageCount = originalDoc.getPageCount();

            // 处理每一页
            for (let i = 0; i < pageCount; i++) {
                // 发送进度信息
                postMessage({
                    type: 'progress',
                    progress: (i / pageCount) * 100,
                    message: `正在处理第 ${i + 1} 页，共 ${pageCount} 页...`
                });

                // 复制页面
                const [page] = await pdfDoc.copyPages(originalDoc, [i]);
                pdfDoc.addPage(page);

                // 获取页面对象
                const pageObj = page.node;
                const resources = pageObj.Resources;

                // 处理图像
                if (resources && resources.XObject) {
                    const xObjects = resources.XObject.dict;

                    for (const [name, xObject] of Object.entries(xObjects)) {
                        if (xObject instanceof PDFLib.PDFImage) {
                            try {
                                // 获取图像数据
                                const width = xObject.width || xObject.Size[0];
                                const height = xObject.height || xObject.Size[1];
                                const rawData = await xObject.getRawData();
                                
                                // 创建 ImageData
                                const imageData = new ImageData(
                                    new Uint8ClampedArray(rawData),
                                    width,
                                    height
                                );

                                // 处理图像
                                const processedData = await this.imageProcessor.processImage(imageData);
                                
                                if (processedData) {
                                    // 嵌入处理后的图像
                                    const image = await pdfDoc.embedJpg(processedData);
                                    xObjects[name] = image.ref;
                                }
                            } catch (error) {
                                console.error('处理图像失败:', error);
                            }
                        }
                    }
                }
            }

            // 处理元数据
            if (this.settings.removeMetadata) {
                pdfDoc.setTitle('');
                pdfDoc.setAuthor('');
                pdfDoc.setSubject('');
                pdfDoc.setKeywords([]);
                pdfDoc.setProducer('');
                pdfDoc.setCreator('');
            }

            // 保存压缩后的 PDF
            const compressedPdfBytes = await pdfDoc.save({
                useObjectStreams: true,
                addDefaultPage: false,
                useCompression: this.settings.textCompression,
                objectsPerTick: 50
            });

            return compressedPdfBytes;
        } catch (error) {
            throw new Error(`PDF 压缩失败: ${error.message}`);
        }
    }
}

// EPUB 压缩器 (待实现)
class EPUBCompressor {
    constructor(settings) {
        this.settings = settings;
    }

    async compressEPUB(arrayBuffer) {
        throw new Error('EPUB 压缩功能尚未实现');
    }
}

// 主压缩接口
const compression = {
    async compressFile(file, compressionLevel) {
        try {
            const settings = compressionSettings[compressionLevel] || compressionSettings.medium;
            const arrayBuffer = await file.arrayBuffer();

            if (file.name.toLowerCase().endsWith('.pdf')) {
                const compressor = new PDFCompressor(settings);
                return await compressor.compressPDF(arrayBuffer);
            } else if (file.name.toLowerCase().endsWith('.epub')) {
                const compressor = new EPUBCompressor(settings);
                return await compressor.compressEPUB(arrayBuffer);
            } else {
                throw new Error('不支持的文件类型');
            }
        } catch (error) {
            throw error;
        }
    }
};

// 暴露接口
Comlink.expose(compression); 