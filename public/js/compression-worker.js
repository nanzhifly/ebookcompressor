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

// 图像压缩引擎
class ImageCompressionEngine {
    constructor(level) {
        this.params = {
            low: {
                quality: 0.9,
                maxSize: 2048,
                colorSpace: 'rgb',
                method: 'jpeg'
            },
            medium: {
                quality: 0.6,
                maxSize: 1600,
                colorSpace: 'rgb',
                method: 'jpeg+flate'
            },
            high: {
                quality: 0.4,
                maxSize: 1200,
                colorSpace: 'grayscale',
                method: 'jpeg+flate'
            }
        }[level] || this.params.medium;
    }

    async processImage(imageData, width, height) {
        try {
            // 创建离屏画布
            const canvas = new OffscreenCanvas(width, height);
            const ctx = canvas.getContext('2d', {
                alpha: false,
                willReadFrequently: true
            });

            // 绘制图像
            ctx.putImageData(imageData, 0, 0);

            // 计算新尺寸
            let newWidth = width;
            let newHeight = height;
            if (Math.max(width, height) > this.params.maxSize) {
                const ratio = this.params.maxSize / Math.max(width, height);
                newWidth = Math.floor(width * ratio);
                newHeight = Math.floor(height * ratio);
            }

            // 创建缩放画布
            const scaleCanvas = new OffscreenCanvas(newWidth, newHeight);
            const scaleCtx = scaleCanvas.getContext('2d', {
                alpha: false,
                willReadFrequently: true
            });

            // 应用高质量缩放
            scaleCtx.imageSmoothingEnabled = true;
            scaleCtx.imageSmoothingQuality = 'high';
            scaleCtx.drawImage(canvas, 0, 0, newWidth, newHeight);

            // 应用颜色空间转换
            if (this.params.colorSpace === 'grayscale') {
                const imgData = scaleCtx.getImageData(0, 0, newWidth, newHeight);
                const data = imgData.data;
                for (let i = 0; i < data.length; i += 4) {
                    const gray = Math.round(
                        data[i] * 0.299 +
                        data[i + 1] * 0.587 +
                        data[i + 2] * 0.114
                    );
                    data[i] = data[i + 1] = data[i + 2] = gray;
                }
                scaleCtx.putImageData(imgData, 0, 0);
            }

            // 压缩图像
            const blob = await scaleCanvas.convertToBlob({
                type: 'image/jpeg',
                quality: this.params.quality
            });

            // 如果使用额外的压缩
            if (this.params.method.includes('flate')) {
                const compressedData = new Uint8Array(await blob.arrayBuffer());
                return this.applyFlateCompression(compressedData);
            }

            return new Uint8Array(await blob.arrayBuffer());
        } catch (error) {
            console.error('图像处理失败:', error);
            return null;
        }
    }

    applyFlateCompression(data) {
        // 使用 PDF-lib 的 Flate 压缩
        return PDFLib.deflate(data);
    }
}

// 内容压缩引擎
class ContentCompressionEngine {
    constructor(level) {
        this.params = {
            low: {
                compress: true,
                level: 1
            },
            medium: {
                compress: true,
                level: 6
            },
            high: {
                compress: true,
                level: 9
            }
        }[level] || this.params.medium;
    }

    async processContent(content) {
        if (!content) return null;
        try {
            return PDFLib.deflate(content, this.params.level);
        } catch (error) {
            console.error('内容压缩失败:', error);
            return content;
        }
    }
}

// 混合压缩引擎
class HybridCompressionEngine {
    constructor(level) {
        this.level = level;
        this.imageEngine = new ImageCompressionEngine(level);
        this.contentEngine = new ContentCompressionEngine(level);
    }

    async compressPDF(arrayBuffer) {
        try {
            // 加载原始文档
            const pdfDoc = await PDFLib.PDFDocument.load(arrayBuffer);
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
                const [page] = await newPdfDoc.copyPages(pdfDoc, [i]);
                
                // 处理页面内容
                await this.processPage(page);
                
                newPdfDoc.addPage(page);
            }

            // 根据压缩级别设置保存选项
            const saveOptions = this.getSaveOptions();
            
            // 保存文档
            return await newPdfDoc.save(saveOptions);

        } catch (error) {
            throw new Error(`PDF 压缩失败: ${error.message}`);
        }
    }

    async processPage(page) {
        try {
            const pageDict = page.node;
            const resources = pageDict.Resources;

            if (resources) {
                // 处理图像
                if (resources.XObject) {
                    const xObjects = resources.XObject.dict;
                    for (const [name, xObject] of Object.entries(xObjects)) {
                        if (xObject instanceof PDFLib.PDFImage) {
                            await this.processImage(xObject, page);
                        }
                    }
                }

                // 处理内容流
                if (pageDict.Contents) {
                    await this.processContents(pageDict.Contents);
                }
            }
        } catch (error) {
            console.error('页面处理失败:', error);
        }
    }

    async processImage(image, page) {
        try {
            const width = image.width || image.Size[0];
            const height = image.height || image.Size[1];
            const rawData = await image.getRawData();

            // 创建图像数据
            const imageData = new ImageData(
                new Uint8ClampedArray(rawData),
                width,
                height
            );

            // 使用图像引擎处理
            const processedData = await this.imageEngine.processImage(
                imageData,
                width,
                height
            );

            if (processedData) {
                // 嵌入处理后的图像
                const newImage = await page.doc.embedJpg(processedData);
                Object.assign(image, newImage);
            }
        } catch (error) {
            console.error('图像处理失败:', error);
        }
    }

    async processContents(contents) {
        try {
            if (Array.isArray(contents)) {
                for (const content of contents) {
                    await this.processSingleContent(content);
                }
            } else {
                await this.processSingleContent(contents);
            }
        } catch (error) {
            console.error('内容处理失败:', error);
        }
    }

    async processSingleContent(content) {
        try {
            if (!content) return;
            const data = await content.getContents();
            if (data) {
                const processed = await this.contentEngine.processContent(data);
                if (processed) {
                    content.setContent(processed);
                }
            }
        } catch (error) {
            console.error('单个内容处理失败:', error);
        }
    }

    getSaveOptions() {
        const options = {
            low: {
                useObjectStreams: true,
                addDefaultPage: false,
                useCompression: true,
                objectsPerTick: 50,
                compress: true,
                deflateLevel: 1
            },
            medium: {
                useObjectStreams: true,
                addDefaultPage: false,
                useCompression: true,
                objectsPerTick: 40,
                compress: true,
                deflateLevel: 6
            },
            high: {
                useObjectStreams: true,
                addDefaultPage: false,
                useCompression: true,
                objectsPerTick: 30,
                compress: true,
                deflateLevel: 9,
                preserveObjectIds: false
            }
        };

        return options[this.level] || options.medium;
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
                const compressor = new HybridCompressionEngine(compressionLevel);
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