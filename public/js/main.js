document.addEventListener('DOMContentLoaded', async () => {
    // Constants for status messages
    const STATUS_MESSAGES = {
        INIT_ERROR: 'Error: Failed to initialize compression engine',
        COMPRESSION_START: 'Starting compression...',
        COMPRESSION_COMPLETE: (originalSize, compressedSize, ratio) => 
            `Compression complete! ${formatFileSize(originalSize)} → ${formatFileSize(compressedSize)} (${ratio}% smaller)`,
        COMPRESSION_FAILED: 'Compression failed: ',
        ENGINE_NOT_INITIALIZED: 'Error: Compression engine not initialized'
    };

    // DOM Elements
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-input');
    const fileInfo = document.getElementById('fileInfo');
    const compressBtn = document.getElementById('compressBtn');
    const compressionStats = document.getElementById('compressionStats');
    const compressionStatus = document.querySelector('.compression-status');
    const downloadButton = document.querySelector('.download-button');

    let selectedFile = null;
    let worker = null;
    let compression = null;
    let compressedBlob = null;

    // Check if all required dependencies are loaded
    function checkDependencies() {
        const required = ['Comlink', 'JSZip', 'imageCompression', 'HTMLMinifier'];
        const missing = required.filter(dep => typeof window[dep] === 'undefined');
        if (missing.length > 0) {
            throw new Error(`Missing required dependencies: ${missing.join(', ')}`);
        }
    }

    // Initialize Web Worker
    async function initializeWorker() {
        try {
            // Check dependencies first
            checkDependencies();
            
            // Initialize worker
            worker = new Worker('/js/compression-worker.js');
            compression = Comlink.wrap(worker);
            
            // Test worker connection
            await compression.compressFile(new Blob(['test']), 'test');
        } catch (error) {
            console.error('Failed to initialize Web Worker:', error);
            updateCompressionStatus(STATUS_MESSAGES.INIT_ERROR);
            throw error;
        }
    }

    // Initialize Worker
    await initializeWorker();

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

    // 更新下载按钮状态
    function updateDownloadButton(show, fileName = '') {
        if (downloadButton) {
            if (show) {
                downloadButton.style.display = 'inline-block';
                downloadButton.download = fileName;
                downloadButton.classList.add('active');
            } else {
                downloadButton.style.display = 'none';
                downloadButton.classList.remove('active');
            }
        }
    }

    // 处理文件选择
    function handleFiles(files) {
        if (files.length > 0) {
            selectedFile = files[0];
            const fileType = selectedFile.name.toLowerCase().endsWith('.epub') ? 'EPUB' : 'PDF';
            fileInfo.textContent = `已选择${fileType}文件：${selectedFile.name} (${formatFileSize(selectedFile.size)})`;
            compressBtn.disabled = false;
            updateDownloadButton(false);
        }
    }

    // 下载文件
    function downloadBlob(arrayBuffer, fileName) {
        compressedBlob = new Blob([arrayBuffer], { 
            type: fileName.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'application/epub+zip' 
        });
        const url = window.URL.createObjectURL(compressedBlob);
        downloadButton.href = url;
        downloadButton.download = `compressed_${fileName}`;
        updateDownloadButton(true, `compressed_${fileName}`);
    }

    // 处理文件压缩
    async function handleCompression(file, compressionLevel) {
        if (!compression) {
            throw new Error(STATUS_MESSAGES.ENGINE_NOT_INITIALIZED);
        }

        try {
            updateCompressionStatus(STATUS_MESSAGES.COMPRESSION_START);

            // Set up progress handler
            worker.onmessage = (e) => {
                if (e.data.type === 'progress') {
                    updateCompressionStatus(`${e.data.status} (${Math.round(e.data.progress)}%)`);
                }
            };

            // Compress file
            const originalSize = file.size;
            const compressedArrayBuffer = await compression.compressFile(file, compressionLevel);
            const compressedSize = compressedArrayBuffer.size;
            const compressionRatio = ((1 - compressedSize / originalSize) * 100).toFixed(1);

            // Update status
            updateCompressionStatus(
                STATUS_MESSAGES.COMPRESSION_COMPLETE(
                    formatFileSize(originalSize),
                    formatFileSize(compressedSize),
                    compressionRatio
                )
            );

            // Update stats
            if (compressionStats) {
                compressionStats.innerHTML = `
                    File size: ${formatFileSize(originalSize)} → ${formatFileSize(compressedSize)}<br>
                    Compression ratio: ${compressionRatio}%<br>
                    Compression level: ${compressionLevel}
                `;
                compressionStats.style.color = '#28a745';
            }

            return compressedArrayBuffer;
        } catch (error) {
            console.error('Compression error:', error);
            updateCompressionStatus(`${STATUS_MESSAGES.COMPRESSION_FAILED}${error.message}`);
            if (compressionStats) {
                compressionStats.textContent = `Error: ${error.message}`;
                compressionStats.style.color = '#dc3545';
            }
            throw error;
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

    // 初始化下载按钮状态
    updateDownloadButton(false);
});