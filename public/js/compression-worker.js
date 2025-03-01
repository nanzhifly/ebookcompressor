// 导入必要的库
importScripts('https://unpkg.com/pdf-lib@1.17.1/dist/pdf-lib.min.js');
importScripts('https://unpkg.com/comlink@4.4.1/dist/umd/comlink.min.js');

// 压缩设置
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
};

// PDF 压缩函数
async function compressPDF(arrayBuffer, compressionLevel = 'medium') {
    try {
        // 从 ArrayBuffer 加载 PDF
        const pdfDoc = await PDFLib.PDFDocument.load(arrayBuffer);
        
        // 获取页面数量用于进度计算
        const pageCount = pdfDoc.getPageCount();
        
        // 创建新的 PDF 文档
        const newPdfDoc = await PDFLib.PDFDocument.create();
        
        // 获取压缩设置
        const settings = compressionSettings[compressionLevel] || compressionSettings.medium;
        
        // 复制所有页面到新文档
        for (let i = 0; i < pageCount; i++) {
            // 发送进度信息
            postMessage({
                type: 'progress',
                progress: (i / pageCount) * 100,
                message: `Processing page ${i + 1} of ${pageCount}...`
            });
            
            const [copiedPage] = await newPdfDoc.copyPages(pdfDoc, [i]);
            newPdfDoc.addPage(copiedPage);
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
            useCompression: true
        });
        
        return compressedPdfBytes;
    } catch (error) {
        throw new Error(`PDF compression failed: ${error.message}`);
    }
}

// EPUB 压缩函数
async function compressEPUB(arrayBuffer, compressionLevel = 'medium') {
    // TODO: 实现 EPUB 压缩
    throw new Error('EPUB compression is not yet implemented in client-side mode');
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
                throw new Error('Unsupported file type');
            }
        } catch (error) {
            throw error;
        }
    }
};

// 使用 Comlink 暴露接口
Comlink.expose(compression); 