from flask import Flask, jsonify, request
from flask_cors import CORS
import requests
import json
import traceback
from firebase_admin import firestore
from firebase_config import init_firebase
from analyzer import IngredientAnalyzer
from datetime import datetime
import os

app = Flask(__name__)
CORS(app)  # Enable CORS for all routes

db = init_firebase()
analyzer = IngredientAnalyzer()

OPENFOODFACTS_API = "https://world.openfoodfacts.org/api/v0/product/"

def simplify_allergens(allergens_text):
    """Convert allergen codes to simple English"""
    if not allergens_text or allergens_text == 'Not available':
        return 'Not available'
    
    # Common allergen mappings
    allergen_map = {
        'en:milk': 'Milk',
        'en:eggs': 'Eggs', 
        'en:fish': 'Fish',
        'en:crustaceans': 'Shellfish',
        'en:molluscs': 'Molluscs',
        'en:peanuts': 'Peanuts',
        'en:soybeans': 'Soy',
        'en:soy': 'Soy',
        'en:nuts': 'Tree nuts',
        'en:almonds': 'Almonds',
        'en:hazelnuts': 'Hazelnuts',
        'en:walnuts': 'Walnuts',
        'en:cashews': 'Cashews',
        'en:pecans': 'Pecans',
        'en:brazil-nuts': 'Brazil nuts',
        'en:pistachios': 'Pistachios',
        'en:macadamia': 'Macadamia nuts',
        'en:celery': 'Celery',
        'en:mustard': 'Mustard',
        'en:sesame': 'Sesame',
        'en:sulphur-dioxide-and-sulphites': 'Sulphites',
        'en:lupin': 'Lupin',
        'en:gluten': 'Gluten',
        'en:cereals': 'Cereals containing gluten'
    }
    
    allergens = [code.strip() for code in allergens_text.split(',')]
    simplified = []
    
    for allergen in allergens:
        if allergen in allergen_map:
            simplified.append(allergen_map[allergen])
        elif ':' in allergen:
            # Try to extract the part after the colon and capitalize
            parts = allergen.split(':')
            if len(parts) > 1:
                simplified.append(parts[1].replace('-', ' ').title())
        else:
            simplified.append(allergen.title())
    
    return ', '.join(simplified) if simplified else 'None detected'

def simplify_category(category_text):
    """Convert category to simple English"""
    if not category_text or category_text == 'Unknown':
        return 'Unknown'
    
    # Common category simplifications
    category_map = {
        'Pâtes à tartiner': 'Spreads',
        'pâtes à tartiner': 'Spreads',
        'Chocolates': 'Chocolate',
        'chocolates': 'Chocolate',
        'Snacks sucrés': 'Sweet snacks',
        'snacks sucrés': 'Sweet snacks',
        'Boissons': 'Beverages',
        'boissons': 'Beverages',
        'Produits laitiers': 'Dairy products',
        'produits laitiers': 'Dairy products',
        'Viandes': 'Meat',
        'viandes': 'Meat',
        'Légumes et dérivés': 'Vegetables',
        'légumes et dérivés': 'Vegetables',
        'Fruits et produits dérivés': 'Fruits',
        'fruits et produits dérivés': 'Fruits'
    }
    
    # Try exact match first
    if category_text in category_map:
        return category_map[category_text]
    
    # Try to find a match in the text
    for key, value in category_map.items():
        if key.lower() in category_text.lower():
            return value
    
    # If no match, try to clean up the text
    # Remove language prefixes and clean up
    if ',' in category_text:
        categories = category_text.split(',')
        main_category = categories[0].strip()
    else:
        main_category = category_text
    
    # Remove en: prefix if present
    if main_category.startswith('en:'):
        main_category = main_category[3:]
    
    # Replace hyphens with spaces and title case
    return main_category.replace('-', ' ').title()

@app.route('/health', methods=['GET'])
def health_check():
    return jsonify({"status": "healthy", "service": "Barcodeify API"})

@app.route('/product/<barcode>', methods=['GET'])
def get_product(barcode):
    """Fetch product data from OpenFoodFacts and analyze"""
    try:
        # Fetch from OpenFoodFacts with a browser-like user agent to avoid API blocking
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
            'Accept': 'application/json'
        }
        response = requests.get(f"{OPENFOODFACTS_API}{barcode}.json", headers=headers, timeout=10)
        
        if response.status_code != 200:
            return jsonify({
                "error": "Product not found",
                "message": "No data available for this barcode"
            }), 404
        
        data = response.json()
        product = data.get('product', {})
        
        if data.get('status') != 1 or not product:
            return jsonify({
                "error": "Product not found",
                "message": "No data available for this barcode"
            }), 404
        
        # Extract key information
        nutriments = product.get('nutriments', {})
        
        product_info = {
            "barcode": barcode,
            "name": product.get('product_name', 'Unknown Product'),
            "brand": product.get('brands', 'Unknown Brand'),
            "image": product.get('image_url', ''),
            "ingredients": product.get('ingredients_text', ''),
            "nutrition_grade": product.get('nutrition_grade', 'unknown').upper(),
            "category": simplify_category(product.get('categories', 'Unknown')),
            "nutrients": nutriments,
            "proteins": nutriments.get('proteins_100g', nutriments.get('proteins', 'Not available')),
            "carbohydrates": nutriments.get('carbohydrates_100g', nutriments.get('carbohydrates', 'Not available')),
            "fats": nutriments.get('fat_100g', nutriments.get('fat', 'Not available')),
            "energy": nutriments.get('energy_100g', nutriments.get('energy-kcal_100g', nutriments.get('energy', 'Not available'))),
            "serving_size": product.get('serving_size', 'Not available'),
            "allergens": simplify_allergens(product.get('allergens', 'Not available'))
        }
        
        # AI Analysis
        ingredient_analysis = analyzer.classify_ingredients(product_info['ingredients'])
        warnings = analyzer.detect_warnings(product_info['ingredients'])
        health_score = analyzer.calculate_health_score(
            product_info['nutrition_grade'], 
            ingredient_analysis
        )
        status = analyzer.get_status(health_score)
        
        analysis = {
            "ingredient_analysis": ingredient_analysis,
            "warnings": warnings,
            "health_score": health_score,
            "status": status
        }
        
        # Save to Firebase
        save_scan_history(barcode, product_info['name'], health_score, status)
        
        return jsonify({
            "success": True,
            "product": product_info,
            "analysis": analysis
        })
        
    except requests.exceptions.RequestException:
        return jsonify({
            "error": "API Error",
            "message": "Unable to fetch product data. Please try again."
        }), 503
    except Exception as e:
        print(f"Error: {str(e)}")
        print(traceback.format_exc())
        return jsonify({
            "error": "Internal Server Error",
            "message": "Something went wrong. Please try again."
        }), 500

@app.route('/history', methods=['GET'])
def get_history():
    """Get last 10 scan history from Firebase"""
    try:
        scans = (
            db.collection('scans')
            .order_by('timestamp', direction=firestore.Query.DESCENDING)
            .limit(10)
            .stream()
        )
        
        history = []
        for scan in scans:
            data = scan.to_dict()
            history.append({
                "id": scan.id,
                "barcode": data['barcode'],
                "name": data['name'],
                "score": data['score'],
                "status": data['status'],
                "timestamp": data['timestamp']
            })
        
        return jsonify({"history": history})
        
    except Exception as e:
        print(f"History error: {str(e)}")
        return jsonify({"history": []})

def save_scan_history(barcode, name, score, status):
    """Save scan to Firebase Firestore"""
    try:
        db.collection('scans').add({
            'barcode': barcode,
            'name': name,
            'score': score,
            'status': status,
            'timestamp': firestore.SERVER_TIMESTAMP
        })
    except Exception as e:
        print(f"Failed to save history: {str(e)}")

@app.route('/alternatives/<category>/<exclude_barcode>', methods=['GET'])
def get_alternatives(category, exclude_barcode):
    """Simple mock - In production, implement category search"""
    # This is a simplified version. Real implementation would search OpenFoodFacts
    mock_alternatives = [
        {
            "barcode": "3017620422003",
            "name": "Organic Tomato Sauce",
            "brand": "Organic Brand",
            "nutrition_grade": "A",
            "health_score": 9
        },
        {
            "barcode": "3017280014007",
            "name": "Natural Ketchup",
            "brand": "Healthy Choice",
            "nutrition_grade": "B",
            "health_score": 8
        }
    ]
    return jsonify({"alternatives": mock_alternatives[:3]})

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    debug = os.environ.get('FLASK_DEBUG', '0') == '1'
    app.run(host='0.0.0.0', port=port, debug=debug, use_reloader=False)
