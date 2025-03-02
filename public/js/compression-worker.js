// 导入必要的库
importScripts('/js/vendor/comlink.min.js');
importScripts('/js/vendor/jszip.min.js');
importScripts('/js/vendor/browser-image-compression.js');
importScripts('/js/vendor/htmlminifier.min.js');

// 检查依赖是否正确加载
async function checkDependencies() {
    const required = {
        'Comlink': () => typeof Comlink !== 'undefined',
        'JSZip': () => typeof self.JSZip !== 'undefined',
        'imageCompression': () => typeof self.imageCompression !== 'undefined',
        'HTMLMinifier': () => {
            const minifier = self.minify || self.htmlMinifier || self.HTMLMinifier;
            return typeof minifier === 'function';
        }
    };

    // 等待一小段时间确保所有脚本加载完成
    await new Promise(resolve => setTimeout(resolve, 100));

    const missing = Object.entries(required)
        .filter(([name, check]) => !check())
        .map(([name]) => name);

    if (missing.length > 0) {
        throw new Error(`Missing required dependencies: ${missing.join(', ')}`);
    }

    return true;
}

// EPUB 压缩器
class EPUBCompressor {
    constructor(level) {
        this.level = level;
        this.compressionStrategies = {
            low: {
                imageQuality: 0.8,    // 80% 质量
                imageScale: 1.0,      // 保持原始尺寸
                convertToGrayscale: false,
                cssMinify: true,
                htmlMinify: true
            },
            medium: {
                imageQuality: 0.5,    // 50% 质量
                imageScale: 0.75,     // 缩小到75%
                convertToGrayscale: false,
                cssMinify: true,
                htmlMinify: true
            },
            high: {
                imageQuality: 0.3,    // 30% 质量
                imageScale: 0.5,      // 缩小到50%
                convertToGrayscale: true,
                cssMinify: true,
                htmlMinify: true
            }
        };
        // 初始化临时目录和状态
        this.tempDir = 'temp_' + Date.now();
        this.progress = 0;
        this.status = '准备中...';
    }

    // 更新进度和状态
    updateProgress(progress, status) {
        this.progress = progress;
        this.status = status;
        postMessage({ type: 'progress', progress, status });
    }

    async compressEPUB(file) {
        try {
            // 创建新的 JSZip 实例
            const zip = new self.JSZip();
            
            // 读取原始 EPUB 文件
            const epubData = await file.arrayBuffer();
            
            // 加载 EPUB 文件到 JSZip
            const originalZip = await self.JSZip.loadAsync(epubData);
            
            // 创建新的压缩后的 EPUB
            const compressedZip = new self.JSZip();
            
            // 遍历并处理所有文件
            for (const [path, file] of Object.entries(originalZip.files)) {
                if (file.dir) {
                    compressedZip.folder(path);
                    continue;
                }

                // 获取文件内容
                const content = await file.async('arraybuffer');
                
                // 根据文件类型进行不同的压缩处理
                if (this.isImageFile(path)) {
                    // 压缩图片
                    const compressedImage = await this.compressImage(new Blob([content]));
                    const compressedBuffer = await compressedImage.arrayBuffer();
                    compressedZip.file(path, compressedBuffer);
                } else if (this.isHTMLFile(path)) {
                    // 压缩 HTML
                    const htmlText = await file.async('text');
                    const minifiedHTML = await this.minifyHTML(htmlText);
                    compressedZip.file(path, minifiedHTML);
                } else if (this.isCSSFile(path)) {
                    // 压缩 CSS
                    const cssText = await file.async('text');
                    const minifiedCSS = await this.minifyCSS(cssText);
                    compressedZip.file(path, minifiedCSS);
                } else {
                    // 其他文件直接复制
                    compressedZip.file(path, content);
                }
            }
            
            // 生成压缩后的 EPUB 文件
            const compressedEPUB = await compressedZip.generateAsync({
                type: 'blob',
                compression: 'DEFLATE',
                compressionOptions: {
                    level: 9
                }
            });
            
            return compressedEPUB;
        } catch (error) {
            console.error('EPUB 压缩失败:', error);
            throw error;
        }
    }

    async createTempDirectory() {
        // 在内存中创建一个虚拟的目录结构
        return {
            files: new Map(),  // 存储文件内容
            directories: new Set(),  // 存储目录路径
            addFile: function(path, content) {
                this.files.set(path, content);
                // 创建父目录
                let dirPath = path.split('/').slice(0, -1).join('/');
                while (dirPath) {
                    this.directories.add(dirPath);
                    dirPath = dirPath.split('/').slice(0, -1).join('/');
                }
            },
            getFile: function(path) {
                return this.files.get(path);
            },
            listFiles: function() {
                return Array.from(this.files.keys());
            },
            listDirectories: function() {
                return Array.from(this.directories);
            }
        };
    }

    async extractEPUB(arrayBuffer) {
        try {
            this.updateProgress(0, '正在读取 EPUB 文件...');
            
            // 使用 JSZip 替代 AdmZip
            const zip = new JSZip();
            await zip.loadAsync(arrayBuffer);
            
            this.updateProgress(20, '正在解析 EPUB 结构...');
            
            // 创建临时目录结构
            const epubStructure = {
                images: [],
                html: [],
                css: [],
                other: [],
                container: null,
                opf: null
            };
            
            // 解析文件结构
            for (const [fileName, file] of Object.entries(zip.files)) {
                if (file.dir) continue;
                
                // 获取文件内容
                const fileContent = await file.async('arraybuffer');
                
                // 根据文件类型分类
                if (/\.(jpe?g|png|gif|webp)$/i.test(fileName)) {
                    epubStructure.images.push({ name: fileName, data: fileContent });
                } else if (/\.html?$/i.test(fileName)) {
                    epubStructure.html.push({ name: fileName, data: fileContent });
                } else if (/\.css$/i.test(fileName)) {
                    epubStructure.css.push({ name: fileName, data: fileContent });
                } else if (fileName === 'META-INF/container.xml') {
                    epubStructure.container = { data: fileContent };
                } else if (/\.opf$/i.test(fileName)) {
                    epubStructure.opf = { name: fileName, data: fileContent };
                } else {
                    epubStructure.other.push({ name: fileName, data: fileContent });
                }
            }
            
            this.updateProgress(40, '文件结构解析完成');
            return epubStructure;
            
        } catch (error) {
            console.error('EPUB 提取错误:', error);
            throw new Error('EPUB 文件提取失败: ' + error.message);
        }
    }

    async processImages(epubStructure) {
        try {
            const strategy = this.compressionStrategies[this.level];
            const totalImages = epubStructure.images.length;
            let processedCount = 0;

            // 处理每个图片
            for (const image of epubStructure.images) {
                try {
                    // 获取原始图片数据
                    const imageFile = new File([image.data], image.name, {
                        type: this.getImageMimeType(image.name)
                    });

                    // 设置压缩选项
                    const options = {
                        maxSizeMB: 1,
                        maxWidthOrHeight: Math.max(
                            800 * strategy.imageScale,
                            400
                        ),
                        useWebWorker: false,
                        fileType: this.getImageFormat(image.name),
                        initialQuality: strategy.imageQuality
                    };

                    // 压缩图片
                    const compressedFile = await self.imageCompression(imageFile, options);
                    const compressedBuffer = await compressedFile.arrayBuffer();

                    // 更新图片数据
                    image.data = compressedBuffer;

                    // 更新进度
                    processedCount++;
                    this.updateProgress(
                        40 + (processedCount / totalImages) * 20,
                        `处理图片 ${processedCount}/${totalImages}: ${image.name}`
                    );

                } catch (error) {
                    console.error(`处理图片失败 ${image.name}:`, error);
                    // 如果处理失败，保留原图
                    continue;
                }
            }

            this.updateProgress(60, '图片处理完成，开始处理 HTML/CSS...');
            return epubStructure;

        } catch (error) {
            console.error('图片处理过程失败:', error);
            throw error;
        }
    }

    // 获取图片 MIME 类型
    getImageMimeType(filename) {
        const ext = filename.toLowerCase().split('.').pop();
        const mimeTypes = {
            'jpg': 'image/jpeg',
            'jpeg': 'image/jpeg',
            'png': 'image/png',
            'gif': 'image/gif',
            'webp': 'image/webp'
        };
        return mimeTypes[ext] || 'application/octet-stream';
    }

    // 获取图片格式
    getImageFormat(filename) {
        const ext = filename.toLowerCase().split('.').pop();
        return ext === 'jpg' ? 'jpeg' : ext;
    }

    async processHTMLAndCSS(tempDir, epubStructure) {
        try {
            const strategy = this.compressionStrategies[this.level];
            const totalFiles = epubStructure.html.length + epubStructure.css.length;
            let processedCount = 0;

            // 检查压缩器是否可用
            if (typeof window.HTMLMinifier === 'undefined') {
                console.warn('HTML/CSS 压缩器未正确加载，将保持原始文件');
                return epubStructure;
            }

            const minifierOptions = {
                collapseBooleanAttributes: true,
                collapseWhitespace: true,
                decodeEntities: true,
                html5: true,
                minifyCSS: true,  // 使用内置的 CSS 压缩
                minifyJS: true,
                processConditionalComments: true,
                removeComments: true,
                removeEmptyAttributes: true,
                removeOptionalTags: true,
                removeRedundantAttributes: true,
                removeScriptTypeAttributes: true,
                removeStyleLinkTypeAttributes: true,
                trimCustomFragments: true,
                useShortDoctype: true
            };

            // 处理 CSS 文件
            for (const cssFile of epubStructure.css) {
                try {
                    const cssText = new TextDecoder().decode(cssFile.data);
                    // 对于 CSS 文件，使用特殊的选项
                    const minifiedCSS = window.HTMLMinifier.minify(cssText, {
                        minifyCSS: true,
                        removeComments: true,
                        collapseWhitespace: true
                    });
                    cssFile.data = new TextEncoder().encode(minifiedCSS).buffer;

                    processedCount++;
                    this.updateProgress(
                        60 + (processedCount / totalFiles) * 20,
                        `处理 CSS 文件 ${processedCount}/${epubStructure.css.length}: ${cssFile.name}`
                    );
                } catch (error) {
                    console.error(`处理 CSS 文件失败 ${cssFile.name}:`, error);
                    // 如果处理失败，保留原文件
                    continue;
                }
            }

            // 处理 HTML 文件
            for (const htmlFile of epubStructure.html) {
                try {
                    const htmlText = new TextDecoder().decode(htmlFile.data);
                    const minifiedHTML = window.HTMLMinifier.minify(htmlText, minifierOptions);
                    htmlFile.data = new TextEncoder().encode(minifiedHTML).buffer;

                    processedCount++;
                    this.updateProgress(
                        60 + (processedCount / totalFiles) * 20,
                        `处理 HTML 文件 ${processedCount - epubStructure.css.length}/${epubStructure.html.length}: ${htmlFile.name}`
                    );
                } catch (error) {
                    console.error(`处理 HTML 文件失败 ${htmlFile.name}:`, error);
                    // 如果处理失败，保留原文件
                    continue;
                }
            }

            this.updateProgress(80, 'HTML/CSS 处理完成，准备重新打包...');
            return epubStructure;

        } catch (error) {
            console.error('HTML/CSS 处理过程失败:', error);
            // 如果整个处理过程失败，返回未修改的结构
            return epubStructure;
        }
    }

    async repackEPUB(tempDir, epubStructure) {
        try {
            // 创建新的 ZIP 文件
            const zip = new JSZip();

            // 添加 mimetype 文件（如果存在）
            // mimetype 必须是第一个文件，且不能被压缩
            if (tempDir.getFile('mimetype')) {
                zip.file('mimetype', tempDir.getFile('mimetype'), '');
            }

            // 添加所有其他文件
            const allFiles = tempDir.listFiles();
            for (const filePath of allFiles) {
                if (filePath === 'mimetype') continue;  // 跳过已添加的 mimetype

                const content = tempDir.getFile(filePath);
                if (content) {
                    // 使用标准压缩级别
                    zip.file(filePath, content);
                }
            }

            // 生成最终的 EPUB 文件
            const finalBuffer = await zip.generateAsync({ type: 'nodebuffer' });

            this.updateProgress(100, 'EPUB 打包完成！');

            return finalBuffer;

        } catch (error) {
            console.error('EPUB 重新打包失败:', error);
            throw error;
        }
    }

    async cleanup(tempDir) {
        // 清理临时数据
        tempDir.files.clear();
        tempDir.directories.clear();
        this.tempDir = null;
        this.progress = 0;
        this.status = '已完成';
    }

    async minifyCSS(cssText) {
        // 检查 HTMLMinifier 是否可用
        const minifier = self.minify || self.htmlMinifier || self.HTMLMinifier;
        if (!minifier) {
            console.warn('HTML Minifier not loaded, skipping CSS compression');
            return cssText;
        }

        try {
            const minifiedCSS = minifier(cssText, {
                collapseWhitespace: true,
                removeComments: true,
                minifyCSS: true
            });
            return minifiedCSS;
        } catch (error) {
            console.error('CSS compression failed:', error);
            return cssText;
        }
    }

    async minifyHTML(htmlText) {
        // 检查 HTMLMinifier 是否可用
        const minifier = self.minify || self.htmlMinifier || self.HTMLMinifier;
        if (!minifier) {
            console.warn('HTML Minifier not loaded, skipping HTML compression');
            return htmlText;
        }

        const minifierOptions = {
            collapseWhitespace: true,
            conservativeCollapse: true,
            removeComments: true,
            removeEmptyAttributes: true,
            removeRedundantAttributes: true,
            removeScriptTypeAttributes: true,
            removeStyleLinkTypeAttributes: true,
            minifyCSS: true,
            minifyJS: true
        };

        try {
            const minifiedHTML = minifier(htmlText, minifierOptions);
            return minifiedHTML;
        } catch (error) {
            console.error('HTML compression failed:', error);
            return htmlText;
        }
    }
}

// 主压缩接口
const compression = {
    checkDependencies,
    async compressFile(file, compressionLevel) {
        try {
            // 确保依赖已加载
            await checkDependencies();

            if (compressionLevel === 'test') {
                return new Blob(['test']);
            }

            const arrayBuffer = await file.arrayBuffer();

            if (file.name.toLowerCase().endsWith('.epub')) {
                const compressor = new EPUBCompressor(compressionLevel);
                return await compressor.compressEPUB(file);
            } else {
                throw new Error('Unsupported file type. Only EPUB format is supported.');
            }
        } catch (error) {
            console.error('Compression failed:', error);
            throw error;
        }
    }
};

// 暴露接口
Comlink.expose(compression);

// 导出压缩器类
Comlink.expose(EPUBCompressor);