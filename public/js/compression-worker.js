// 导入必要的库
importScripts('/js/lib/pdf-lib.min.js');
importScripts('/js/lib/comlink.min.js');

// PDF 内容分析器
class PDFAnalyzer {
    async analyzePDF(pdfDoc) {
        const analysis = {
            pageCount: pdfDoc.getPageCount(),
            images: [],
            fonts: new Set(),
            metadata: {},
            totalSize: 0
        };

        // 分析每一页
        for (let i = 0; i < analysis.pageCount; i++) {
            const page = pdfDoc.getPage(i);
            const pageDict = page.node;
            await this.analyzePage(pageDict, analysis);
        }

        return analysis;
    }

    async analyzePage(pageDict, analysis) {
        if (pageDict.Resources) {
            // 分析图像
            if (pageDict.Resources.XObject) {
                const xObjects = pageDict.Resources.XObject.dict;
                for (const [name, xObject] of Object.entries(xObjects)) {
                    if (xObject instanceof PDFLib.PDFImage) {
                        analysis.images.push({
                            name,
                            width: xObject.width || xObject.Size[0],
                            height: xObject.height || xObject.Size[1],
                            object: xObject
                        });
                    }
                }
            }

            // 分析字体
            if (pageDict.Resources.Font) {
                const fonts = pageDict.Resources.Font.dict;
                for (const font of Object.values(fonts)) {
                    analysis.fonts.add(font);
                }
            }
        }
    }
}

// 压缩策略配置
const compressionStrategies = {
    low: {
        image: {
            quality: 0.8,
            maxSize: 2048,
            colorSpace: 'RGB',
            downscale: false
        },
        text: {
            compression: true,
            level: 1
        },
        fonts: {
            subset: false,
            compress: false
        },
        metadata: {
            preserve: true
        }
    },
    medium: {
        image: {
            quality: 0.6,
            maxSize: 1600,
            colorSpace: 'RGB',
            downscale: true
        },
        text: {
            compression: true,
            level: 6
        },
        fonts: {
            subset: true,
            compress: true
        },
        metadata: {
            preserve: false
        }
    },
    high: {
        image: {
            quality: 0.3,
            maxSize: 1200,
            colorSpace: 'grayscale',
            downscale: true
        },
        text: {
            compression: true,
            level: 9
        },
        fonts: {
            subset: true,
            compress: true
        },
        metadata: {
            preserve: false
        }
    }
};

// 图像处理器
class ImageProcessor {
    constructor(strategy) {
        this.strategy = strategy;
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
            // 创建初始画布
            const { canvas, ctx } = await this.createCanvas(
                imageData.width,
                imageData.height
            );

            // 绘制原始图像
            ctx.putImageData(imageData, 0, 0);

            // 计算新尺寸
            let newWidth = imageData.width;
            let newHeight = imageData.height;

            // 如果需要缩放
            if (this.strategy.downscale && 
                (newWidth > this.strategy.maxSize || newHeight > this.strategy.maxSize)) {
                const ratio = Math.min(
                    this.strategy.maxSize / newWidth,
                    this.strategy.maxSize / newHeight
                );
                newWidth = Math.floor(newWidth * ratio);
                newHeight = Math.floor(newHeight * ratio);

                // 创建缩放画布
                const { canvas: scaleCanvas, ctx: scaleCtx } = await this.createCanvas(
                    newWidth,
                    newHeight
                );

                // 使用高质量缩放
                scaleCtx.imageSmoothingEnabled = true;
                scaleCtx.imageSmoothingQuality = 'high';
                scaleCtx.drawImage(canvas, 0, 0, newWidth, newHeight);
                canvas = scaleCanvas;
                ctx = scaleCtx;
            }

            // 如果需要转换为灰度
            if (this.strategy.colorSpace === 'grayscale') {
                const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                const data = imageData.data;

                for (let i = 0; i < data.length; i += 4) {
                    const gray = Math.round(
                        data[i] * 0.299 +
                        data[i + 1] * 0.587 +
                        data[i + 2] * 0.114
                    );
                    data[i] = data[i + 1] = data[i + 2] = gray;
                }

                ctx.putImageData(imageData, 0, 0);
            }

            // 转换为压缩后的数据
            const blob = await canvas.convertToBlob({
                type: 'image/jpeg',
                quality: this.strategy.quality
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
    constructor(level) {
        this.strategy = compressionStrategies[level] || compressionStrategies.medium;
        this.analyzer = new PDFAnalyzer();
        this.imageProcessor = new ImageProcessor(this.strategy.image);
    }

    async compressPDF(arrayBuffer) {
        try {
            // 创建新的 PDF 文档
            const newPdfDoc = await PDFLib.PDFDocument.create();
            const originalDoc = await PDFLib.PDFDocument.load(arrayBuffer);

            // 分析 PDF 结构
            const analysis = await this.analyzer.analyzePDF(originalDoc);

            // 处理每一页
            for (let i = 0; i < analysis.pageCount; i++) {
                // 发送进度信息
                postMessage({
                    type: 'progress',
                    progress: (i / analysis.pageCount) * 100,
                    message: `正在处理第 ${i + 1} 页，共 ${analysis.pageCount} 页...`
                });

                // 复制页面
                const [page] = await newPdfDoc.copyPages(originalDoc, [i]);
                newPdfDoc.addPage(page);

                // 处理页面内容
                await this.processPage(page, analysis);
            }

            // 处理元数据
            if (!this.strategy.metadata.preserve) {
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
                useCompression: this.strategy.text.compression,
                objectsPerTick: 50
            });

            return compressedPdfBytes;
        } catch (error) {
            throw new Error(`PDF 压缩失败: ${error.message}`);
        }
    }

    async processPage(page, analysis) {
        const pageDict = page.node;
        const resources = pageDict.Resources;

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
                            const image = await page.doc.embedJpg(processedData);
                            xObjects[name] = image.ref;
                        }
                    } catch (error) {
                        console.error('处理图像失败:', error);
                    }
                }
            }
        }
    }
}

// EPUB 压缩器 (待实现)
class EPUBCompressor {
    constructor(level) {
        this.strategy = compressionStrategies[level];
    }

    async compressEPUB(arrayBuffer) {
        throw new Error('EPUB 压缩功能尚未实现');
    }
}

// 主压缩接口
const compression = {
    async compressFile(file, compressionLevel) {
        try {
            const arrayBuffer = await file.arrayBuffer();

            if (file.name.toLowerCase().endsWith('.pdf')) {
                const compressor = new PDFCompressor(compressionLevel);
                return await compressor.compressPDF(arrayBuffer);
            } else if (file.name.toLowerCase().endsWith('.epub')) {
                const compressor = new EPUBCompressor(compressionLevel);
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