const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { PDFDocument } = require('pdf-lib');
const AdmZip = require('adm-zip');
const EPub = require('epub-parser');
const sharp = require('sharp');
const Jimp = require('jimp');

const app = express();
const port = process.env.PORT || 3000;

// 设置静态文件目录
app.use(express.static('public'));

// 配置文件上传
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, '/tmp/');  // Vercel 只允许写入 /tmp 目录
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + path.extname(file.originalname));
    }
});

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 50 * 1024 * 1024 // 50MB
    },
    fileFilter: (req, file, cb) => {
        const validTypes = ['application/pdf', 'application/epub+zip'];
        if (validTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Invalid file type'));
        }
    }
});

// 使用 pdf-lib 压缩 PDF
async function compressPDF(inputPath, outputPath, compressionLevel) {
    try {
        console.log('=== Starting PDF-Lib PDF compression ===');
        console.log('Compression level:', compressionLevel);
        
        // 读取原始 PDF 文件
        const pdfBytes = fs.readFileSync(inputPath);
        const pdfDoc = await PDFDocument.load(pdfBytes);
        
        // 获取页面数量
        const pageCount = pdfDoc.getPageCount();
        console.log(`PDF has ${pageCount} pages`);
        
        // 根据压缩级别设置不同的参数
        const compressionSettings = {
            'low': {
                imageQuality: 0.8,    // 图像质量 (0-1)
                compressImages: true,  // 是否压缩图像
                removeMetadata: false  // 是否移除元数据
            },
            'medium': {
                imageQuality: 0.6,
                compressImages: true,
                removeMetadata: true
            },
            'high': {
                imageQuality: 0.4,
                compressImages: true,
                removeMetadata: true
            }
        }[compressionLevel] || {
            imageQuality: 0.6,
            compressImages: true,
            removeMetadata: true
        };
        
        // 创建新的 PDF 文档
        const newPdfDoc = await PDFDocument.create();
        
        // 复制所有页面到新文档
        for (let i = 0; i < pageCount; i++) {
            const [copiedPage] = await newPdfDoc.copyPages(pdfDoc, [i]);
            newPdfDoc.addPage(copiedPage);
        }
        
        // 如果需要移除元数据
        if (compressionSettings.removeMetadata) {
            // 清除元数据
            newPdfDoc.setTitle('');
            newPdfDoc.setAuthor('');
            newPdfDoc.setSubject('');
            newPdfDoc.setKeywords([]);
            newPdfDoc.setProducer('');
            newPdfDoc.setCreator('');
        }
        
        // 保存压缩后的 PDF
        const compressedPdfBytes = await newPdfDoc.save({
            // pdf-lib 的压缩选项
            useObjectStreams: true,
            addDefaultPage: false,
            useCompression: true
        });
        
        // 写入文件
        fs.writeFileSync(outputPath, compressedPdfBytes);
        
        // 验证输出文件
        if (!fs.existsSync(outputPath)) {
            throw new Error(`Output file was not created: ${outputPath}`);
        }
        
        const originalSize = fs.statSync(inputPath).size;
        const compressedSize = fs.statSync(outputPath).size;
        const compressionRatio = ((1 - compressedSize / originalSize) * 100).toFixed(2);
        
        console.log('=== Compression Results ===');
        console.log('Original size:', originalSize, 'bytes');
        console.log('Compressed size:', compressedSize, 'bytes');
        console.log('Compression ratio:', compressionRatio + '%');
        
        return true;
    } catch (error) {
        console.error('PDF compression error:', error);
        throw error;
    }
}

// EPUB 压缩函数
async function compressEPUB(inputPath, outputPath, compressionLevel) {
    try {
        console.log('=== Starting EPUB compression ===');
        
        // 读取 EPUB 文件
        const zip = new AdmZip(inputPath);
        const entries = zip.getEntries();

        // 根据压缩级别设置图片质量和其他参数
        const compressionSettings = {
            'low': {
                imageQuality: 90,      // 更高的图片质量
                optimizeImages: true,  // 优化图片
                compressText: false    // 不压缩文本
            },
            'medium': {
                imageQuality: 70,
                optimizeImages: true,
                compressText: true
            },
            'high': {
                imageQuality: 50,
                optimizeImages: true,
                compressText: true
            }
        }[compressionLevel] || {
            imageQuality: 70,
            optimizeImages: true,
            compressText: true
        };

        // 记录原始大小
        const originalSize = fs.statSync(inputPath).size;

        // 处理所有文件
        for (const entry of entries) {
            if (entry.entryName.match(/\.(jpe?g|png|gif)$/i)) {
                // 处理图片文件
                const imageBuffer = entry.getData();
                let compressedImage;

                try {
                    if (entry.entryName.match(/\.png$/i)) {
                        // PNG 图片处理
                        compressedImage = await sharp(imageBuffer)
                            .png({ 
                                quality: compressionSettings.imageQuality,
                                compressionLevel: 9,
                                palette: true
                            })
                            .toBuffer();
                    } else if (entry.entryName.match(/\.(jpg|jpeg)$/i)) {
                        // JPEG 图片处理
                        compressedImage = await sharp(imageBuffer)
                            .jpeg({ 
                                quality: compressionSettings.imageQuality,
                                mozjpeg: true
                            })
                            .toBuffer();
                    } else if (entry.entryName.match(/\.gif$/i)) {
                        // GIF 图片处理
                        const image = await Jimp.read(imageBuffer);
                        compressedImage = await image
                            .quality(compressionSettings.imageQuality)
                            .getBufferAsync(Jimp.MIME_GIF);
                    }

                    // 只有当压缩后的图片更小时才更新
                    if (compressedImage && compressedImage.length < imageBuffer.length) {
                        zip.updateFile(entry.entryName, compressedImage);
                    }
                } catch (error) {
                    console.warn(`Warning: Failed to compress image ${entry.entryName}:`, error.message);
                }
            } else if (compressionSettings.compressText && 
                      entry.entryName.match(/\.(html?|css|xml|opf|ncx)$/i)) {
                // 压缩文本文件
                const content = entry.getData().toString('utf8');
                const minified = content
                    .replace(/\s+/g, ' ')           // 压缩空白字符
                    .replace(/>\s+</g, '><')        // 移除标签间的空白
                    .replace(/<!--[\s\S]*?-->/g, '') // 移除注释
                    .trim();
                zip.updateFile(entry.entryName, Buffer.from(minified, 'utf8'));
            }
        }

        // 写入压缩后的 EPUB 文件
        zip.writeZip(outputPath);

        // 计算压缩结果
        const compressedSize = fs.statSync(outputPath).size;
        const compressionRatio = ((1 - compressedSize / originalSize) * 100).toFixed(2);

        console.log('=== Compression Results ===');
        console.log('Original size:', originalSize, 'bytes');
        console.log('Compressed size:', compressedSize, 'bytes');
        console.log('Compression ratio:', compressionRatio + '%');

        return true;
    } catch (error) {
        console.error('EPUB compression error:', error);
        throw error;
    }
}

// 处理文件压缩
app.post('/compress', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            throw new Error('No file uploaded');
        }

        const file = req.file;
        const compressionLevel = req.body.compressionLevel || 'medium';
        const outputPath = path.join('/tmp', `compressed_${file.filename}`);

        console.log('File received:', {
            originalname: file.originalname,
            mimetype: file.mimetype,
            size: file.size,
            path: file.path
        });
        console.log('Compression level:', compressionLevel);

        let success = false;
        const isEPUB = file.originalname.toLowerCase().endsWith('.epub');
        const compressFunction = isEPUB ? compressEPUB : compressPDF;
        success = await compressFunction(file.path, outputPath, compressionLevel);

        if (!success) {
            throw new Error('Compression failed');
        }

        // 确保输出文件存在
        if (!fs.existsSync(outputPath)) {
            throw new Error('Compressed file was not created');
        }

        const inputStats = fs.statSync(file.path);
        const outputStats = fs.statSync(outputPath);
        
        console.log('Original size:', inputStats.size);
        console.log('Compressed size:', outputStats.size);
        console.log('Compression completed successfully');

        res.json({
            success: true,
            downloadUrl: `/download/${path.basename(outputPath)}`,
            compressedSize: outputStats.size,
            originalSize: inputStats.size
        });

    } catch (error) {
        console.error('Compression error:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Compression failed'
        });
    }
});

// 文件下载路由
app.get('/download/:filename', (req, res) => {
    const file = path.join('/tmp', req.params.filename);
    res.download(file);
});

// 定期清理上传的文件
function cleanupUploads() {
    const uploadsDir = '/tmp';
    fs.readdir(uploadsDir, (err, files) => {
        if (err) throw err;

        files.forEach(file => {
            const filePath = path.join(uploadsDir, file);
            fs.stat(filePath, (err, stats) => {
                if (err) throw err;

                // 删除超过1小时的文件
                if (Date.now() - stats.mtime.getTime() > 3600000) {
                    fs.unlink(filePath, err => {
                        if (err) console.error(`Error deleting ${file}:`, err);
                    });
                }
            });
        });
    });
}

// 每小时运行一次清理
setInterval(cleanupUploads, 3600000);

function startServer(port) {
    app.listen(port, () => {
        console.log(`Server running at http://localhost:${port}`);
    }).on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            console.log(`Port ${port} is busy, trying ${port + 1}...`);
            startServer(port + 1);
        } else {
            console.error('Server error:', err);
        }
    });
}

// 启动服务器
startServer(port); 