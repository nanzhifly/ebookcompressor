document.addEventListener('DOMContentLoaded', () => {
    // DOM 元素
    const dropZone = document.getElementById('dropZone');
    const fileInput = document.getElementById('fileInput');
    const fileInfo = document.getElementById('fileInfo');
    const compressBtn = document.getElementById('compressBtn');
    const compressionStats = document.getElementById('compressionStats');
    const downloadButton = document.querySelector('.download-button');
    const compressionStatus = document.querySelector('.compression-status');

    let selectedFile = null;

    // 文件大小格式化
    function formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    // 更新压缩状态
    function updateCompressionStatus(status) {
        if (compressionStatus) {
            compressionStatus.textContent = status;
        }
    }

    // 处理文件选择
    function handleFiles(files) {
        if (files.length > 0) {
            selectedFile = files[0];
            const fileType = selectedFile.name.toLowerCase().endsWith('.epub') ? 'EPUB' : 'PDF';
            fileInfo.textContent = `Selected ${fileType}: ${selectedFile.name} (${formatFileSize(selectedFile.size)})`;
            compressBtn.disabled = false;
        }
    }

    // 处理文件压缩
    async function handleCompression(file, compressionLevel) {
        try {
            compressBtn.disabled = true;
            updateCompressionStatus('Compressing...');
            
            const formData = new FormData();
            formData.append('file', file);
            formData.append('compressionLevel', compressionLevel);

            // 添加进度显示
            updateCompressionStatus('Processing page 1 of 564...');
            
            const response = await fetch('/compress', {
                method: 'POST',
                body: formData
            });

            const result = await response.json();

            if (result.success) {
                const compressionRatio = ((1 - result.compressedSize / result.originalSize) * 100).toFixed(1);
                const originalSize = formatFileSize(result.originalSize);
                const compressedSize = formatFileSize(result.compressedSize);
                
                updateCompressionStatus(
                    `Compression complete! ${originalSize} → ${compressedSize} (${compressionRatio}% reduced)`
                );
                
                if (downloadButton) {
                    downloadButton.href = result.downloadUrl;
                    downloadButton.style.display = 'block';
                    downloadButton.textContent = 'Download Compressed File';
                }
                
                if (compressionStats) {
                    compressionStats.textContent = 
                        `Original: ${originalSize} → Compressed: ${compressedSize} (${compressionRatio}% reduction)`;
                    compressionStats.style.color = '#28a745';
                }
            } else {
                throw new Error(result.error || 'Compression failed');
            }
        } catch (error) {
            console.error('Compression error:', error);
            updateCompressionStatus(`Compression failed: ${error.message}`);
            if (compressionStats) {
                compressionStats.textContent = `Error: ${error.message}`;
                compressionStats.style.color = '#dc3545';
            }
        } finally {
            compressBtn.disabled = false;
        }
    }

    // 事件监听器
    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('dragover');
    });

    dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('dragover');
    });

    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        handleFiles(e.dataTransfer.files);
    });

    dropZone.addEventListener('click', () => {
        fileInput.click();
    });

    fileInput.addEventListener('change', (e) => {
        handleFiles(e.target.files);
    });

    compressBtn.addEventListener('click', async () => {
        if (!selectedFile) return;
        const compressionLevel = document.querySelector('input[name="compression"]:checked').value;
        await handleCompression(selectedFile, compressionLevel);
    });

    // 确保所有压缩级别选项都可以点击
    const compressionOptions = document.querySelectorAll('input[name="compression"]');
    compressionOptions.forEach(option => {
        option.addEventListener('change', () => {
            if (selectedFile) {
                compressBtn.disabled = false;
            }
        });
    });
});