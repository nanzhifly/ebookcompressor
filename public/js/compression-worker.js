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

// PDF 流压缩处理器
class PDFStreamCompressor {
    constructor(level) {
        this.level = level;
        this.compressionParams = {
            low: {
                objectCompression: 1,    // 最基础的对象压缩
                streamCompression: 2,    // 低级别的流压缩
                imageQuality: 0.9,       // 保持图像高质量
                optimizeStructure: false // 不优化结构
            },
            medium: {
                objectCompression: 4,    // 中等对象压缩
                streamCompression: 6,    // 中等流压缩
                imageQuality: 0.7,       // 中等图像质量
                optimizeStructure: true  // 优化结构
            },
            high: {
                objectCompression: 9,    // 最高对象压缩
                streamCompression: 9,    // 最高流压缩
                imageQuality: 0.5,       // 较低图像质量
                optimizeStructure: true  // 优化结构
            }
        }[level] || this.compressionParams.medium;
    }

    async compressPDF(arrayBuffer) {
        try {
            // 1. 加载 PDF 文档
            const pdfDoc = await PDFLib.PDFDocument.load(arrayBuffer);
            
            // 2. 创建新的 PDF 文档
            const newPdfDoc = await PDFLib.PDFDocument.create();
            
            // 3. 获取页面数量
            const pageCount = pdfDoc.getPageCount();
            
            // 4. 处理每一页
            for (let i = 0; i < pageCount; i++) {
                // 发送进度信息
                postMessage({
                    type: 'progress',
                    progress: (i / pageCount) * 100,
                    message: `正在处理第 ${i + 1} 页，共 ${pageCount} 页...`
                });

                // 复制页面
                const [page] = await newPdfDoc.copyPages(pdfDoc, [i]);
                
                // 处理页面内容流
                await this.compressPageContent(page);
                
                newPdfDoc.addPage(page);
            }

            // 5. 应用文档级压缩
            return await newPdfDoc.save({
                useObjectStreams: true,
                addDefaultPage: false,
                useCompression: true,
                objectsPerTick: 30,
                compress: true,
                // PDF-lib 特定的压缩参数
                deflateLevel: this.compressionParams.streamCompression,
                // 结构优化选项
                linearize: this.compressionParams.optimizeStructure,
                // 更激进的压缩选项
                compressStreams: true,
                preserveObjectIds: false,
                updateFieldAppearances: false
            });
        } catch (error) {
            throw new Error(`PDF 压缩失败: ${error.message}`);
        }
    }

    async compressPageContent(page) {
        try {
            const pageDict = page.node;
            const resources = pageDict.Resources;

            if (resources) {
                // 压缩图像对象
                if (resources.XObject) {
                    const xObjects = resources.XObject.dict;
                    for (const [name, xObject] of Object.entries(xObjects)) {
                        if (xObject instanceof PDFLib.PDFImage) {
                            await this.compressImageObject(xObject, page);
                        }
                    }
                }

                // 压缩内容流
                if (pageDict.Contents) {
                    await this.compressContentStream(pageDict.Contents);
                }
            }
        } catch (error) {
            console.error('页面压缩失败:', error);
        }
    }

    async compressImageObject(image, page) {
        try {
            // 获取图像数据
            const imageData = await image.getRawData();
            
            // 创建压缩上下文
            const canvas = new OffscreenCanvas(
                image.width || image.Size[0],
                image.height || image.Size[1]
            );
            const ctx = canvas.getContext('2d');

            // 创建图像数据
            const imgData = new ImageData(
                new Uint8ClampedArray(imageData),
                canvas.width,
                canvas.height
            );

            // 绘制图像
            ctx.putImageData(imgData, 0, 0);

            // 压缩图像
            const blob = await canvas.convertToBlob({
                type: 'image/jpeg',
                quality: this.compressionParams.imageQuality
            });

            // 转换为数组缓冲区
            const compressedData = new Uint8Array(await blob.arrayBuffer());

            // 替换原始图像
            const newImage = await page.doc.embedJpg(compressedData);
            Object.assign(image, newImage);

        } catch (error) {
            console.error('图像压缩失败:', error);
        }
    }

    async compressContentStream(contents) {
        try {
            if (Array.isArray(contents)) {
                // 处理多个内容流
                for (const content of contents) {
                    await this.compressStream(content);
                }
            } else {
                // 处理单个内容流
                await this.compressStream(contents);
            }
        } catch (error) {
            console.error('内容流压缩失败:', error);
        }
    }

    async compressStream(stream) {
        try {
            if (!stream) return;

            // 获取流数据
            const data = await stream.getContents();
            if (!data) return;

            // 应用压缩
            stream.setCompression(true);
            stream.setDeflateLevel(this.compressionParams.streamCompression);

        } catch (error) {
            console.error('流压缩失败:', error);
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
                const compressor = new PDFStreamCompressor(compressionLevel);
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