const API_BASE = window.BARCODIFY_API_BASE || (
    window.location.hostname === 'localhost'
        ? 'http://localhost:5000'
        : 'http://127.0.0.1:5000'
);

// DOM Elements
const resultsSection = document.getElementById('results');
const loadingOverlay = document.getElementById('loading-overlay');
const historyList = document.getElementById('history-list');

// Initialize app
document.addEventListener('DOMContentLoaded', function() {
    loadHistory();
    
    // Smooth scrolling for nav links
    document.querySelectorAll('.nav-link').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const targetId = link.getAttribute('href').substring(1);
            document.getElementById(targetId).scrollIntoView({ behavior: 'smooth' });
        });
    });
});

async function searchBarcode(barcode) {
    showLoading(true);
    stopScanner();

    const scannerSection = document.getElementById('scanner');
    if (!scannerSection.classList.contains('hidden')) {
        toggleScanner();
    }
    
    try {
        const response = await fetch(`${API_BASE}/product/${barcode}`, { mode: 'cors' });
        const data = await response.json();
        
        if (response.ok && data.success) {
            displayProduct(data);
            resultsSection.scrollIntoView({ behavior: 'smooth' });
            resultsSection.classList.remove('hidden');
        } else {
            showError(data.message || 'Product not found');
        }
    } catch (error) {
        console.error('Search error:', error);
        showError(`Backend is not reachable at ${API_BASE}. Start the Flask server, then try again.`);
    } finally {
        showLoading(false);
    }
}

function displayProduct(data) {
    const product = data.product;
    const analysis = data.analysis;

    // Nutrition chart (optional UI enhancement)
    if (typeof renderNutritionChart === 'function') {
        renderNutritionChart({
            proteins: product.proteins,
            carbohydrates: product.carbohydrates,
            fats: product.fats,
            energy: product.energy,
        });
    }

    
    // Product info
    document.getElementById('product-name').textContent = product.name;
    document.getElementById('product-brand').textContent = product.brand;
    const productImage = document.getElementById('product-image');
    productImage.src = product.image || 'https://via.placeholder.com/120x120/667eea/ffffff?text=No+Image';
    productImage.onerror = function() {
        this.src = 'https://via.placeholder.com/120x120/667eea/ffffff?text=No+Image';
    };
    
    // Health score
    document.getElementById('score-number').textContent = analysis.health_score;
    document.getElementById('score-fill').style.width = `${analysis.health_score * 10}%`;
    document.getElementById('product-status').textContent = analysis.status;
    document.getElementById('product-status').className = `status-badge status-${analysis.status.toLowerCase().split(' ')[0]}`;
    
    // Nutrition grade
    const gradeElement = document.getElementById('nutrition-grade');
    gradeElement.textContent = product.nutrition_grade;
    gradeElement.className = `nutrition-grade grade-${product.nutrition_grade.toLowerCase()}`;
    
    // Nutritional details
    document.getElementById('proteins').textContent = product.proteins !== 'Not available' ? `${product.proteins}g` : 'Not available';
    document.getElementById('carbohydrates').textContent = product.carbohydrates !== 'Not available' ? `${product.carbohydrates}g` : 'Not available';
    document.getElementById('fats').textContent = product.fats !== 'Not available' ? `${product.fats}g` : 'Not available';
    document.getElementById('energy').textContent = product.energy !== 'Not available' ? product.energy : 'Not available';
    
    // Additional product details
    document.getElementById('category').textContent = product.category || 'Not available';
    document.getElementById('serving-size').textContent = product.serving_size || 'Not available';
    document.getElementById('allergens').textContent = product.allergens || 'Not available';
    document.getElementById('barcode').textContent = product.barcode || 'Not available';
    
    // Ingredient analysis
    displayIngredientAnalysis(analysis.ingredient_analysis);
    
    // Warnings
    displayWarnings(analysis.warnings);
    
    // Alternatives (mock data for demo)
    displayAlternatives(product.category, product.barcode);
}

function displayIngredientAnalysis(analysis) {
    const container = document.getElementById('ingredient-breakdown');
    container.innerHTML = `
        <div class="ingredient-item ingredient-safe">
            <span class="ingredient-count">${analysis.safe}</span>
            <span class="ingredient-label">Safe</span>
        </div>
        <div class="ingredient-item ingredient-moderate">
            <span class="ingredient-count">${analysis.moderate}</span>
            <span class="ingredient-label">Moderate</span>
        </div>
        <div class="ingredient-item ingredient-harmful">
            <span class="ingredient-count">${analysis.harmful}</span>
            <span class="ingredient-label">Harmful</span>
        </div>
    `;
}

function displayWarnings(warnings) {
    const container = document.getElementById('warnings-list');
    
    if (warnings.length === 0) {
        container.innerHTML = '<p style="color: #10b981; text-align: center;">No major warnings detected! 🎉</p>';
        return;
    }
    
    container.innerHTML = warnings.map(warning => 
        `<span class="warning-badge">${warning}</span>`
    ).join('');
}

async function displayAlternatives(category, excludeBarcode) {
    try {
        // Call backend alternatives endpoint.
        // Backend currently returns mock data; frontend will render it with "available on" shopping apps.
        const resp = await fetch(`${API_BASE}/alternatives/${encodeURIComponent(category || 'Unknown')}/${encodeURIComponent(excludeBarcode || '')}`, { mode: 'cors' });
        const data = await resp.json();

        const alternatives = data.alternatives || [];

        // Map of store/platform labels to feel like Blinkit/Zepto-style availability.
        // Since we don't have real SKU/store routing yet, we show a subtle UI tag.
        const platformPool = ['Blinkit', 'Zepto', 'BigBasket', 'Instamart'];

        const container = document.getElementById('alternatives-list');
        container.innerHTML = alternatives.slice(0, 3).map((alt, idx) => {
            const platform = platformPool[idx % platformPool.length];
            return `
            <div class="alternative-card">
                <div class="alternative-name">${alt.name}</div>
                <div class="alternative-grade">
                    <div class="nutrition-grade grade-${(alt.nutrition_grade || 'A').toLowerCase()}">${alt.nutrition_grade || 'A'}</div>
                    <span style="margin-left: 0.75rem; font-weight:700; font-size:0.9rem; color:#64748b; white-space:nowrap;">
                        Available on ${platform}
                    </span>
                </div>
                <div class="alternative-score">${alt.health_score}/10</div>
                <div style="margin-top: 0.75rem; font-size: 0.9rem; color: #64748b;">
                    ${alt.brand}
                </div>
            </div>
        `;
        }).join('');
    } catch (error) {
        console.error('Alternatives error:', error);
    }
}


async function loadHistory() {
    try {
        const response = await fetch(`${API_BASE}/history`, { mode: 'cors' });
        const data = await response.json();
        
        const container = document.getElementById('history-list');
        if (data.history.length === 0) {
            container.innerHTML = '<p style="text-align: center; color: #64748b; grid-column: 1/-1;">No scan history yet. Start scanning!</p>';
            return;
        }
        
        container.innerHTML = data.history.map(item => `
            <div class="history-item">
                <div class="history-name">${item.name}</div>
                <div class="history-score">
                    <span style="font-weight: 600;">${item.score}/10</span>
                    <span class="history-status status-${item.status.toLowerCase().split(' ')[0]}">${item.status}</span>
                </div>
                <div style="margin-top: 1rem; font-size: 0.9rem; color: #64748b;">
                    ${new Date(item.timestamp?.seconds * 1000).toLocaleDateString()}
                </div>
            </div>
        `).join('');
    } catch (error) {
        console.error('History load error:', error);
    }
}

function showLoading(show) {
    loadingOverlay.classList.toggle('hidden', !show);
}

function showError(message) {
    const modal = document.getElementById('error-modal');
    document.getElementById('error-message').textContent = message;
    modal.classList.remove('hidden');
}

function closeErrorModal() {
    document.getElementById('error-modal').classList.add('hidden');
}
