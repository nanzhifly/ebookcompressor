const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { PDFDocument } = require('pdf-lib');
const AdmZip = require('adm-zip');
const gs = require('ghostscript4js');
const EPub = require('epub-parser');
const sharp = require('sharp');
const Jimp = require('jimp');

const app = express();
let port = 3001;

// 设置静态文件目录
app.use(express.static('public'));

// 配置文件上传
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'uploads/');
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

// 使用 Ghostscript 压缩 PDF
async function compressPDFWithGhostscript(inputPath, outputPath, compressionLevel) {
    try {
        console.log('=== Starting Ghostscript PDF compression ===');
        console.log('Compression level:', compressionLevel);
        
        // 根据压缩级别设置不同的参数
        let gsSettings;
        switch (compressionLevel) {
            case 'low':
                gsSettings = {
                    colorRes: '150',             // 与默认相同
                    grayRes: '150',
                    monoRes: '150',
                    pdfSettings: '/printer',     // 使用打印质量
                    extraArgs: [
                        '-dDoThumbnails=false',  // 禁用缩略图
                        '-dCompressFonts=false', // 不压缩字体
                        '-dPreserveMarkedContent=true'  // 保留标记内容
                    ]
                };
                break;
            case 'medium':
                gsSettings = {
                    colorRes: '120',
                    grayRes: '120',
                    monoRes: '120',
                    pdfSettings: '/ebook'
                };
                break;
            case 'high':
                gsSettings = {
                    colorRes: '72',
                    grayRes: '72',
                    monoRes: '72',
                    pdfSettings: '/screen'
                };
                break;
            default:
                gsSettings = {
                    colorRes: '150',
                    grayRes: '150',
                    monoRes: '150',
                    pdfSettings: '/ebook'
                };
        }

        // 使用绝对路径
        const absoluteInputPath = path.resolve(inputPath);
        const absoluteOutputPath = path.resolve(outputPath);

        // 基本的 Ghostscript 参数
        const gsArgs = [
            '-q',
            '-dNOPAUSE',
            '-dBATCH',
            '-dSAFER',
            '-sDEVICE=pdfwrite',
            '-dCompatibilityLevel=1.4',
            `-dPDFSETTINGS=${gsSettings.pdfSettings}`,
            '-dEmbedAllFonts=true',
            '-dSubsetFonts=true',
            '-dAutoRotatePages=/None',
            `-dColorImageResolution=${gsSettings.colorRes}`,
            `-dGrayImageResolution=${gsSettings.grayRes}`,
            `-dMonoImageResolution=${gsSettings.monoRes}`,
            ...(gsSettings.extraArgs || []),
            `-sOutputFile=${absoluteOutputPath}`,
            absoluteInputPath
        ];

        // 输出完整命令
        console.log('Ghostscript command:', gsArgs.join(' '));

        // 执行压缩
        console.log('Compressing PDF with Ghostscript...');
        await gs.execute(gsArgs);

        // 验证输出文件
        if (!fs.existsSync(absoluteOutputPath)) {
            throw new Error(`Output file was not created: ${absoluteOutputPath}`);
        }

        const originalSize = fs.statSync(absoluteInputPath).size;
        const compressedSize = fs.statSync(absoluteOutputPath).size;
        const compressionRatio = ((1 - compressedSize / originalSize) * 100).toFixed(2);

        console.log('=== Compression Results ===');
        console.log('Original size:', originalSize, 'bytes');
        console.log('Compressed size:', compressedSize, 'bytes');
        console.log('Compression ratio:', compressionRatio + '%');

        return true;
    } catch (error) {
        console.error('Compression error:', error);
        throw error;
    }
}

// 修改原来的 compressPDF 函数，使用新的压缩方法
async function compressPDF(inputPath, outputPath, compressionLevel) {
    return await compressPDFWithGhostscript(inputPath, outputPath, compressionLevel);
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
        const outputPath = path.join('uploads', `compressed_${file.filename}`);

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
    const file = path.join(__dirname, '../uploads', req.params.filename);
    res.download(file);
});

// 定期清理上传的文件
function cleanupUploads() {
    const uploadsDir = path.join(__dirname, '../uploads');
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