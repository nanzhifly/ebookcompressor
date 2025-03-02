// 导入必要的库
importScripts('/js/lib/pdf-lib.min.js');
importScripts('/js/lib/comlink.min.js');

// 服务器配置
const SERVER_URL = 'http://localhost:3000';

// PDF 内容分析器
class PDFContentAnalyzer {
    constructor() {
        this.contentTypes = {
            TEXT: 'text',
            IMAGE: 'image',
            VECTOR: 'vector',
            FONT: 'font'
        };
    }

    async analyzePDF(pdfDoc) {
        const analysis = {
            pageCount: pdfDoc.getPageCount(),
            contentMap: new Map(),
            totalSize: 0,
            stats: {
                imageCount: 0,
                totalImageSize: 0,
                textStreamCount: 0,
                totalTextSize: 0,
                vectorCount: 0,
                fontCount: 0
            }
        };

        // 分析每一页
        for (let i = 0; i < analysis.pageCount; i++) {
            const page = pdfDoc.getPage(i);
            await this.analyzePage(page, analysis);
            
            // 发送进度信息
            postMessage({
                type: 'progress',
                progress: (i / analysis.pageCount) * 30,
                message: `分析第 ${i + 1}/${analysis.pageCount} 页...`
            });
        }

        return analysis;
    }

    async analyzePage(page, analysis) {
        const pageDict = page.node;
        const resources = pageDict.Resources;
        
        if (!resources) return;

        // 分析图像对象
        if (resources.XObject) {
            const xObjects = resources.XObject.dict;
            for (const [name, xObject] of Object.entries(xObjects)) {
                if (xObject instanceof PDFLib.PDFImage) {
                    const imageInfo = await this.analyzeImage(xObject);
                    analysis.stats.imageCount++;
                    analysis.stats.totalImageSize += imageInfo.size;
                    analysis.contentMap.set(name, {
                        type: this.contentTypes.IMAGE,
                        ...imageInfo
                    });
                }
            }
        }

        // 分析文本和字体
        if (resources.Font) {
            const fonts = resources.Font.dict;
            for (const [name, font] of Object.entries(fonts)) {
                const fontInfo = await this.analyzeFont(font);
                analysis.stats.fontCount++;
                analysis.contentMap.set(name, {
                    type: this.contentTypes.FONT,
                    ...fontInfo
                });
            }
        }

        // 分析内容流
        if (pageDict.Contents) {
            const streamInfo = await this.analyzeContentStream(pageDict.Contents);
            analysis.stats.textStreamCount++;
            analysis.stats.totalTextSize += streamInfo.size;
        }
    }

    async analyzeImage(image) {
        return {
            width: image.width || image.Size[0],
            height: image.height || image.Size[1],
            bitsPerComponent: image.BitsPerComponent,
            colorSpace: image.ColorSpace,
            size: (await image.getRawData()).length,
            filter: image.Filter,
            compressionPotential: this.estimateCompressionPotential(image)
        };
    }

    async analyzeFont(font) {
        return {
            subtype: font.Subtype,
            baseFont: font.BaseFont,
            isEmbedded: !!font.FontDescriptor,
            isSubset: font.BaseFont?.toString().startsWith('/'),
            size: font.FontDescriptor ? 
                  (await font.FontDescriptor.FontFile?.getRawData())?.length || 0 : 0
        };
    }

    async analyzeContentStream(contents) {
        let totalSize = 0;
        try {
            if (contents instanceof PDFLib.PDFArray) {
                // 处理内容流数组
                for (let i = 0; i < contents.size(); i++) {
                    const stream = contents.get(i);
                    if (stream instanceof PDFLib.PDFStream) {
                        totalSize += (await stream.sizeInBytes()) || 0;
                    }
                }
            } else if (contents instanceof PDFLib.PDFStream) {
                // 处理单个内容流
                totalSize = (await contents.sizeInBytes()) || 0;
            }
        } catch (error) {
            console.error('分析内容流失败:', error);
        }
        return { size: totalSize };
    }

    estimateCompressionPotential(image) {
        // 评估图像的压缩潜力
        let potential = 'medium';
        
        // 检查是否已经压缩
        if (image.Filter?.includes('DCTDecode')) {
            potential = 'low'; // JPEG 已压缩
        } else if (image.BitsPerComponent > 8 || 
                  image.ColorSpace === 'DeviceCMYK') {
            potential = 'high'; // 高位深或CMYK图像
        }
        
        return potential;
    }
}

// 压缩策略管理器
class CompressionStrategyManager {
    constructor(level) {
        this.level = level;
        this.analyzer = new PDFContentAnalyzer();
    }

    getImageStrategy(imageInfo) {
        const strategies = {
            low: {
                quality: 0.8,          // 提高质量到80%
                maxSize: 2048,         // 保持原始尺寸上限
                colorSpace: 'rgb',     // 保持彩色
                method: 'jpeg'         // 使用JPEG格式
            },
            medium: {
                quality: 0.5,          // 中等质量50%
                maxSize: 1536,         // 降低到原尺寸的75%
                colorSpace: 'rgb',     // 保持彩色
                method: 'jpeg+flate'   // 使用JPEG+额外压缩
            },
            high: {
                quality: 0.3,          // 低质量30%
                maxSize: 1024,         // 降低到原尺寸的50%
                colorSpace: 'grayscale', // 转换为灰度
                method: 'jpeg+flate'   // 使用JPEG+额外压缩
            }
        };

        // 根据压缩级别和图像分析结果调整策略
        const baseStrategy = strategies[this.level];
        
        // 根据图像特征微调策略
        if (imageInfo.compressionPotential === 'low') {
            // 已经压缩过的图像，稍微提高质量
            baseStrategy.quality = Math.min(baseStrategy.quality + 0.1, 0.9);
        } else if (imageInfo.compressionPotential === 'high') {
            // 未压缩或高位深图像，可以加大压缩力度
            baseStrategy.quality = Math.max(baseStrategy.quality - 0.1, 0.2);
        }

        return baseStrategy;
    }

    getTextStrategy() {
        return {
            low: { compress: true, level: 3 },
            medium: { compress: true, level: 6 },
            high: { compress: true, level: 9 }
        }[this.level];
    }

    getFontStrategy() {
        return {
            low: { subset: true, compress: true },
            medium: { subset: true, compress: true },
            high: { subset: true, compress: true }
        }[this.level];
    }

    getVectorStrategy() {
        return {
            low: { optimize: false },
            medium: { optimize: true },
            high: { optimize: true, simplify: true }
        }[this.level];
    }
}

// 分层压缩引擎
class LayeredCompressionEngine {
    constructor(level) {
        this.level = level;
        this.strategyManager = new CompressionStrategyManager(level);
        this.analyzer = new PDFContentAnalyzer();
    }

    async compressPDF(arrayBuffer) {
        try {
            const pdfDoc = await PDFLib.PDFDocument.load(arrayBuffer);
            const analysis = await this.analyzer.analyzePDF(pdfDoc);
            const newPdfDoc = await PDFLib.PDFDocument.create();

            // 处理每一页
            for (let i = 0; i < analysis.pageCount; i++) {
                postMessage({
                    type: 'progress',
                    progress: 30 + (i / analysis.pageCount) * 70,
                    message: `压缩第 ${i + 1}/${analysis.pageCount} 页...`
                });

                const [page] = await newPdfDoc.copyPages(pdfDoc, [i]);
                await this.processPage(page, analysis.contentMap);
                newPdfDoc.addPage(page);
            }

            // 优化保存选项
            return await newPdfDoc.save({
                useObjectStreams: true,
                addDefaultPage: false,
                useCompression: true,
                objectsPerTick: Math.max(20, Math.min(50, analysis.pageCount * 2)),
                compress: true,
                deflateLevel: this.getDeflateLevel(),
                preserveObjectIds: false
            });

        } catch (error) {
            console.error('PDF压缩失败:', error);
            throw error;
        }
    }

    async processPage(page, contentMap) {
        try {
            const pageDict = page.node;
            const resources = pageDict.Resources;

            if (!resources) return;

            // 处理图像
            if (resources.XObject) {
                const xObjects = resources.XObject.dict;
                for (const [name, xObject] of Object.entries(xObjects)) {
                    if (xObject instanceof PDFLib.PDFImage) {
                        const contentInfo = contentMap.get(name);
                        if (contentInfo) {
                            await this.processImage(xObject, page, contentInfo);
                        }
                    }
                }
            }

            // 处理内容流
            if (pageDict.Contents) {
                await this.processContents(pageDict.Contents);
            }

        } catch (error) {
            console.error('页面处理失败:', error);
        }
    }

    async processImage(image, page, contentInfo) {
        try {
            const strategy = this.strategyManager.getImageStrategy(contentInfo);
            const rawData = await image.getRawData();
            
            // 创建图像数据
            const imageData = new ImageData(
                new Uint8ClampedArray(rawData),
                contentInfo.width,
                contentInfo.height
            );

            // 处理图像
            const processedData = await this.compressImage(
                imageData,
                contentInfo.width,
                contentInfo.height,
                strategy
            );

            if (processedData) {
                const newImage = await page.doc.embedJpg(processedData);
                Object.assign(image, newImage);
            }
        } catch (error) {
            console.error('图像处理失败:', error);
        }
    }

    async compressImage(imageData, width, height, strategy) {
        try {
            // 创建离屏画布
            const canvas = new OffscreenCanvas(width, height);
            const ctx = canvas.getContext('2d', {
                alpha: false,
                willReadFrequently: true
            });

            // 绘制原始图像
            ctx.putImageData(imageData, 0, 0);

            // 计算新尺寸
            let newWidth = width;
            let newHeight = height;
            if (Math.max(width, height) > strategy.maxSize) {
                const ratio = strategy.maxSize / Math.max(width, height);
                newWidth = Math.floor(width * ratio);
                newHeight = Math.floor(height * ratio);
            }

            // 创建缩放画布
            const scaleCanvas = new OffscreenCanvas(newWidth, newHeight);
            const scaleCtx = scaleCanvas.getContext('2d', {
                alpha: false,
                willReadFrequently: true
            });

            // 使用高质量缩放
            scaleCtx.imageSmoothingEnabled = true;
            scaleCtx.imageSmoothingQuality = 'high';
            scaleCtx.drawImage(canvas, 0, 0, newWidth, newHeight);

            // 应用颜色空间转换
            if (strategy.colorSpace === 'grayscale') {
                const imgData = scaleCtx.getImageData(0, 0, newWidth, newHeight);
                const data = imgData.data;
                for (let i = 0; i < data.length; i += 4) {
                    // 使用更精确的灰度转换公式
                    const gray = Math.round(
                        data[i] * 0.299 +     // Red
                        data[i + 1] * 0.587 + // Green
                        data[i + 2] * 0.114   // Blue
                    );
                    data[i] = data[i + 1] = data[i + 2] = gray;
                }
                scaleCtx.putImageData(imgData, 0, 0);
            }

            // 压缩图像
            const blob = await scaleCanvas.convertToBlob({
                type: 'image/jpeg',
                quality: strategy.quality
            });

            // 如果使用额外的压缩
            if (strategy.method.includes('flate')) {
                const compressedData = new Uint8Array(await blob.arrayBuffer());
                return PDFLib.deflate(compressedData, this.getDeflateLevel());
            }

            return new Uint8Array(await blob.arrayBuffer());
        } catch (error) {
            console.error('图像压缩失败:', error);
            return null;
        }
    }

    async processContents(contents) {
        const strategy = this.strategyManager.getTextStrategy();
        try {
            if (contents instanceof PDFLib.PDFArray) {
                // 处理内容流数组
                for (let i = 0; i < contents.size(); i++) {
                    const stream = contents.get(i);
                    if (stream instanceof PDFLib.PDFStream) {
                        await this.processContentStream(stream, strategy);
                    }
                }
            } else if (contents instanceof PDFLib.PDFStream) {
                // 处理单个内容流
                await this.processContentStream(contents, strategy);
            }
        } catch (error) {
            console.error('处理内容流失败:', error);
        }
    }

    async processContentStream(stream, strategy) {
        try {
            if (!(stream instanceof PDFLib.PDFStream)) return;

            // 获取原始数据
            const data = await stream.access();
            if (!data || !data.length) return;

            // 应用压缩
            const compressed = PDFLib.deflate(data, strategy.level);
            
            // 更新流数据
            await stream.setData(compressed);

            // 设置适当的过滤器
            stream.setFilters([PDFLib.PDFName.of('FlateDecode')]);

        } catch (error) {
            console.error('处理内容流失败:', error);
        }
    }

    getDeflateLevel() {
        return {
            low: 3,      // 轻度压缩
            medium: 6,   // 中度压缩
            high: 9      // 最大压缩
        }[this.level] || 6;
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
                const compressor = new LayeredCompressionEngine(compressionLevel);
                return await compressor.compressPDF(arrayBuffer);
            } else if (file.name.toLowerCase().endsWith('.epub')) {
                throw new Error('EPUB 压缩功能尚未实现');
            } else {
                throw new Error('不支持的文件类型');
            }
        } catch (error) {
            console.error('压缩失败:', error);
            throw error;
        }
    }
};

// 暴露接口
Comlink.expose(compression); 