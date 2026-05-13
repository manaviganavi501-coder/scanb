let codeReader;
let isScannerActive = false;

async function initScanner() {
    codeReader = new ZXing.BrowserMultiFormatReader();
    
    try {
        isScannerActive = true;
        await codeReader.decodeFromVideoDevice(
            null,
            'scanner-video',
            (result, err) => {
                if (result) {
                    console.log('Barcode detected:', result.text);
                    searchBarcode(result.text);
                    codeReader.reset();
                    isScannerActive = false;
                }
                if (err && !(err instanceof ZXing.NotFoundException)) {
                    console.error('Scanner error:', err);
                }
            }
        );
        console.log('Scanner initialized');
    } catch (err) {
        console.error('Error starting scanner:', err);
        showError('Unable to access camera. Please enable camera permissions.');
        isScannerActive = false;
    }
}

function startScanner() {
    const scannerSection = document.getElementById('scanner');
    if (scannerSection.classList.contains('hidden')) {
        toggleScanner();
    }
    setTimeout(initScanner, 300);
}

function toggleScanner() {
    const scannerSection = document.getElementById('scanner');
    const isCurrentlyVisible = !scannerSection.classList.contains('hidden');

    scannerSection.classList.toggle('hidden');
    if (isCurrentlyVisible) {
        stopScanner();
    }

    if (!scannerSection.classList.contains('hidden')) {
        // Scroll to scanner
        scannerSection.scrollIntoView({ behavior: 'smooth' });
    }
}

function searchManualBarcode() {
    const barcodeInput = document.getElementById('manual-barcode');
    const barcode = barcodeInput.value.trim();
    
    if (barcode) {
        searchBarcode(barcode);
        barcodeInput.value = '';
    } else {
        showError('Please enter a valid barcode');
    }
}

function stopScanner() {
    if (codeReader) {
        codeReader.reset();
    }
    isScannerActive = false;
}