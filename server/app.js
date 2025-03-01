const express = require('express');
const multer = require('multer');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
const upload = multer({ dest: 'uploads/' });

// 启用 CORS
app.use(cors());

// 压缩PDF的函数
async function compressPDF(inputPath, outputPath, compressionLevel) {
    return new Promise((resolve, reject) => {
        // 根据压缩级别设置参数
        let gsParams;
        switch(compressionLevel) {
            case 'low':
                gsParams = [
                    '-dPDFSETTINGS=/prepress',  // 较高质量
                    '-dCompatibilityLevel=1.4',
                    '-dColorImageResolution=150',
                    '-dGrayImageResolution=150'
                ];
                break;
            case 'medium':
                gsParams = [
                    '-dPDFSETTINGS=/ebook',     // 中等质量
                    '-dCompatibilityLevel=1.4',
                    '-dColorImageResolution=120',
                    '-dGrayImageResolution=120'
                ];
                break;
            case 'high':
                gsParams = [
                    '-dPDFSETTINGS=/screen',    // 屏幕质量
                    '-dCompatibilityLevel=1.4',
                    '-dColorImageResolution=72',
                    '-dGrayImageResolution=72',
                    '-dConvertCMYKImagesToRGB=true'
                ];
                break;
            default:
                gsParams = ['-dPDFSETTINGS=/ebook'];
        }

        // 构建 Ghostscript 命令
        const command = [
            'gs',
            '-sDEVICE=pdfwrite',
            '-dNOPAUSE',
            '-dQUIET',
            '-dBATCH',
            ...gsParams,
            `-sOutputFile=${outputPath}`,
            inputPath
        ].join(' ');

        // 执行命令
        exec(command, (error, stdout, stderr) => {
            if (error) {
                console.error('压缩过程出错:', error);
                reject(error);
                return;
            }
            resolve(outputPath);
        });
    });
}

// 压缩API端点
app.post('/compress', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            throw new Error('没有收到文件');
        }

        const inputPath = req.file.path;
        const outputPath = path.join('uploads', `compressed_${Date.now()}.pdf`);
        const compressionLevel = req.body.compressionLevel || 'medium';

        // 压缩PDF
        await compressPDF(inputPath, outputPath, compressionLevel);

        // 读取压缩后的文件
        const compressedFile = fs.readFileSync(outputPath);

        // 获取原始文件大小和压缩后文件大小
        const originalSize = req.file.size;
        const compressedSize = fs.statSync(outputPath).size;

        // 清理临时文件
        fs.unlinkSync(inputPath);
        fs.unlinkSync(outputPath);

        // 发送压缩结果
        res.json({
            success: true,
            data: compressedFile.toString('base64'),
            stats: {
                originalSize,
                compressedSize,
                compressionRatio: ((originalSize - compressedSize) / originalSize * 100).toFixed(2)
            }
        });

    } catch (error) {
        console.error('压缩请求处理失败:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 启动服务器
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`服务器运行在端口 ${PORT}`);
}); 