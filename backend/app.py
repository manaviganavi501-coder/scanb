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

from chatbot import get_local_response
from llm_router import llama3_cloud_chat


app = Flask(__name__)
CORS(app)  # Enable CORS for all routes

db = init_firebase()
analyzer = IngredientAnalyzer()

OPENFOODFACTS_API = "https://world.openfoodfacts.org/api/v0/product/"
OPENFOODFACTS_SEARCH_API = "https://world.openfoodfacts.org/cgi/search.pl"
OPENFOODFACTS_HEADERS = {
    'User-Agent': 'Barcodeify/1.0 (student project; product alternatives)',
    'Accept': 'application/json'
}
PRODUCT_FIELDS = (
    'code,product_name,brands,image_url,image_front_url,image_packaging_url,ingredients_text,'
    'nutrition_grade,nutriscore_grade,nutriments,categories,categories_tags,quantity,serving_size'
)
GENERIC_CATEGORY_TAGS = {
    'en:foods',
    'en:beverages',
    'en:plant-based-foods-and-beverages',
    'en:plant-based-foods',
    'en:snacks',
    'en:groceries'
}

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

def fetch_openfoodfacts_product(barcode):
    """Fetch a product document from OpenFoodFacts."""
    response = requests.get(
        f"{OPENFOODFACTS_API}{barcode}.json",
        headers=OPENFOODFACTS_HEADERS,
        timeout=10
    )
    if response.status_code != 200:
        return {}

    data = response.json()
    if data.get('status') != 1:
        return {}
    return data.get('product', {}) or {}

def extract_ingredients_text(product):
    """Read ingredients from the fields OpenFoodFacts commonly uses."""
    for key in (
        'ingredients_text',
        'ingredients_text_en',
        'ingredients_text_with_allergens',
        'ingredients_text_debug'
    ):
        value = product.get(key)
        if value:
            return str(value).strip()

    ingredients = product.get('ingredients') or []
    names = []
    for item in ingredients:
        if not isinstance(item, dict):
            continue
        name = (
            item.get('text')
            or item.get('id')
            or item.get('vegan')
            or ''
        )
        if name:
            names.append(str(name).replace('en:', '').replace('-', ' ').strip())

    return ', '.join(names)

def get_health_score_for_product(product):
    """Calculate a comparable health score for an OpenFoodFacts product."""
    nutrition_grade = (
        product.get('nutrition_grade')
        or product.get('nutriscore_grade')
        or 'unknown'
    )
    ingredient_analysis = analyzer.classify_ingredients(extract_ingredients_text(product))
    return analyzer.calculate_health_score(nutrition_grade.upper(), ingredient_analysis)

def get_nutrient_value(nutriments, *keys):
    for key in keys:
        value = nutriments.get(key)
        if value not in (None, ''):
            return value
    return None

def nutrition_snapshot(nutriments):
    return {
        "energy": get_nutrient_value(nutriments, 'energy-kcal_100g', 'energy-kcal', 'energy_100g', 'energy'),
        "proteins": get_nutrient_value(nutriments, 'proteins_100g', 'proteins'),
        "carbohydrates": get_nutrient_value(nutriments, 'carbohydrates_100g', 'carbohydrates'),
        "fats": get_nutrient_value(nutriments, 'fat_100g', 'fat'),
        "saturated_fat": get_nutrient_value(nutriments, 'saturated-fat_100g', 'saturated-fat'),
        "sugars": get_nutrient_value(nutriments, 'sugars_100g', 'sugars'),
        "sodium": get_nutrient_value(nutriments, 'sodium_100g', 'sodium')
    }

def choose_specific_category_tag(product, fallback_category):
    """Pick the most specific usable category tag for searching alternatives."""
    category_tags = product.get('categories_tags') or []

    for tag in reversed(category_tags):
        if tag and tag not in GENERIC_CATEGORY_TAGS:
            return tag

    if fallback_category and fallback_category != 'Unknown':
        return fallback_category

    categories = product.get('categories', '')
    if categories:
        return simplify_category(categories)

    return ''

def build_alternative_context(scanned_product, fallback_category):
    """Combine scanned product details for product-specific suggestions."""
    query_parts = [
        request.args.get('name', ''),
        request.args.get('brand', ''),
        request.args.get('ingredients', '')
    ]
    product_parts = [
        scanned_product.get('product_name', ''),
        scanned_product.get('brands', ''),
        scanned_product.get('categories', ''),
        extract_ingredients_text(scanned_product)
    ] if scanned_product else []

    return ' '.join(
        str(part)
        for part in [fallback_category, *query_parts, *product_parts]
        if part
    )

def normalize_alternative(product):
    """Map OpenFoodFacts product data into the frontend alternative-card shape."""
    grade = (
        product.get('nutrition_grade')
        or product.get('nutriscore_grade')
        or 'unknown'
    ).upper()

    health_score = get_health_score_for_product(product)
    name = product.get('product_name') or 'Unnamed product'
    category = product.get('categories', 'Unknown')
    ingredients = extract_ingredients_text(product) or get_fallback_ingredients(name, category)
    nutrients = nutrition_snapshot(product.get('nutriments', {}))
    fallback_nutrients = get_fallback_nutrients(name, category)
    nutrients = {
        key: value if value not in (None, '', 'Not available') else fallback_nutrients.get(key)
        for key, value in {**fallback_nutrients, **nutrients}.items()
    }

    return {
        "barcode": product.get('code', ''),
        "name": name,
        "brand": product.get('brands') or 'Unknown brand',
        "image": (
            product.get('image_front_url')
            or product.get('image_packaging_url')
            or product.get('image_url')
            or get_fallback_image(name, category)
        ),
        "category": simplify_category(category),
        "quantity": product.get('quantity') or product.get('serving_size') or '',
        "ingredients": ingredients,
        "nutrients": nutrients,
        "nutrition_grade": grade,
        "health_score": health_score,
        "status": analyzer.get_status(health_score),
        "summary": get_alternative_summary(health_score, ingredients)
    }

def context_contains(context_text, keywords):
    return any(keyword in context_text for keyword in keywords)

def get_alternative_summary(score, ingredients=''):
    ingredients_text = (ingredients or '').lower()
    if score >= 8:
        return 'This product is a stronger everyday choice with a better nutrition profile.'
    if 'sugar' in ingredients_text:
        return 'This option can be a better pick, but still check added sugar on the label.'
    return 'This product is a healthier alternative for the scanned product category.'

def get_fallback_image(name, category_text=''):
    context_text = f"{name} {category_text}".lower()
    image_map = [
        (('noodle', 'ramen', 'maggi'), 'https://images.unsplash.com/photo-1612929633738-8fe44f7ec841?auto=format&fit=crop&w=420&q=80'),
        (('pasta', 'macaroni', 'spaghetti'), 'https://images.unsplash.com/photo-1551183053-bf91a1d81141?auto=format&fit=crop&w=420&q=80'),
        (('biscuit', 'cookie', 'cracker', 'digestive'), 'https://images.unsplash.com/photo-1499636136210-6f4ee915583e?auto=format&fit=crop&w=420&q=80'),
        (('chocolate', 'cocoa', 'cacao'), 'https://images.unsplash.com/photo-1606312619070-d48b4c652a52?auto=format&fit=crop&w=420&q=80'),
        (('chips', 'crisps', 'makhana', 'chana', 'puffs'), 'https://images.unsplash.com/photo-1566478989037-eec170784d0b?auto=format&fit=crop&w=420&q=80'),
        (('cereal', 'muesli', 'granola', 'oats', 'flakes'), 'https://images.unsplash.com/photo-1517093728432-6b0d264e8c8d?auto=format&fit=crop&w=420&q=80'),
        (('water', 'juice', 'drink', 'beverage', 'lassi'), 'https://images.unsplash.com/photo-1523362628745-0c100150b504?auto=format&fit=crop&w=420&q=80'),
        (('yogurt', 'curd', 'dairy', 'milk'), 'https://images.unsplash.com/photo-1488477181946-6428a0291777?auto=format&fit=crop&w=420&q=80'),
        (('sauce', 'ketchup', 'spread', 'jam'), 'https://images.unsplash.com/photo-1472476443507-c7a5948772fc?auto=format&fit=crop&w=420&q=80'),
        (('bar', 'dates', 'fruit'), 'https://images.unsplash.com/photo-1622484212850-eb596d769edc?auto=format&fit=crop&w=420&q=80')
    ]

    for keywords, image_url in image_map:
        if context_contains(context_text, keywords):
            return image_url

    return 'https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=420&q=80'

def get_fallback_nutrients(name, category_text=''):
    context_text = f"{name} {category_text}".lower()
    if context_contains(context_text, ('noodle', 'pasta', 'macaroni')):
        return {"energy": 350, "proteins": 12, "carbohydrates": 65, "fats": 3.5, "saturated_fat": 1.2, "sugars": 2, "sodium": 0.4}
    if context_contains(context_text, ('chocolate', 'cocoa')):
        return {"energy": 510, "proteins": 7, "carbohydrates": 42, "fats": 36, "saturated_fat": 20, "sugars": 18, "sodium": 0.05}
    if context_contains(context_text, ('biscuit', 'cookie', 'cracker')):
        return {"energy": 430, "proteins": 8, "carbohydrates": 68, "fats": 14, "saturated_fat": 5, "sugars": 14, "sodium": 0.35}
    if context_contains(context_text, ('chips', 'makhana', 'chana', 'puffs')):
        return {"energy": 390, "proteins": 14, "carbohydrates": 58, "fats": 9, "saturated_fat": 1.8, "sugars": 3, "sodium": 0.3}
    if context_contains(context_text, ('drink', 'juice', 'water')):
        return {"energy": 35, "proteins": 0, "carbohydrates": 8, "fats": 0, "saturated_fat": 0, "sugars": 6, "sodium": 0.02}
    if context_contains(context_text, ('yogurt', 'curd', 'dairy', 'milk')):
        return {"energy": 80, "proteins": 8, "carbohydrates": 6, "fats": 3, "saturated_fat": 1.8, "sugars": 4, "sodium": 0.08}
    return {"energy": 260, "proteins": 8, "carbohydrates": 38, "fats": 7, "saturated_fat": 1.5, "sugars": 7, "sodium": 0.22}

def get_fallback_ingredients(name, category_text=''):
    context_text = f"{name} {category_text}".lower()
    if context_contains(context_text, ('noodle', 'pasta', 'macaroni')):
        return 'Whole wheat flour, millet flour, dehydrated vegetables, iodized salt, spices, natural antioxidants'
    if context_contains(context_text, ('chocolate', 'cocoa')):
        return 'Cocoa solids, cocoa butter, dates, nuts, natural vanilla, minimal cane sugar'
    if context_contains(context_text, ('biscuit', 'cookie', 'cracker')):
        return 'Whole wheat flour, oats, ragi flour, edible vegetable oil, jaggery, raising agent, iodized salt'
    if context_contains(context_text, ('chips', 'makhana', 'chana', 'puffs')):
        return 'Roasted makhana, roasted chana, millet flour, spices, iodized salt, cold pressed oil'
    if context_contains(context_text, ('cereal', 'muesli', 'granola', 'oats')):
        return 'Rolled oats, ragi flakes, nuts, seeds, dried fruit, cinnamon'
    if context_contains(context_text, ('drink', 'juice', 'water')):
        return 'Water, fruit extract, lemon juice, natural minerals'
    if context_contains(context_text, ('yogurt', 'curd', 'dairy', 'milk')):
        return 'Milk solids, live cultures, natural dairy proteins'
    if context_contains(context_text, ('sauce', 'ketchup', 'spread', 'jam')):
        return 'Tomato pulp, dates, vinegar, spices, iodized salt'
    return 'Whole food ingredients, grains, nuts, seeds, natural seasoning'

def get_fallback_alternatives(category_query, product_context=''):
    """Return relevant local suggestions when live alternatives are unavailable.

    To avoid showing the same alternatives for every product, we try to
    specialize the fallback choice using BOTH the chosen category and the
    scanned product context (name/brand/ingredients).
    """
    category_text = (category_query or '').lower()
    context_text = f"{category_text} {(product_context or '').lower()}"

    # Match groups using broader category terms.
    fallback_groups = [
        (
            ('noodle', 'instant-noodle', 'instant noodle', 'maggi', 'ramen', 'udon'),
            [
                ("24 Mantra Organic Noodles", "24 Mantra", "A", 8.5),
                ("Slurrp Farm Millet Noodles", "Slurrp Farm", "A", 8.2),
                ("True Elements Veg Noodles", "True Elements", "B", 6.8)
            ]
        ),
        (
            ('pasta', 'macaroni', 'spaghetti', 'penne', 'fusilli'),
            [
                ("Whole Wheat Pasta", "Organic Tattva", "A", 8.6),
                ("Millet Macaroni", "Slurrp Farm", "A", 8.1),
                ("Durum Wheat Pasta", "Borges", "B", 7.3)
            ]
        ),
        (
            ('biscuit', 'cookie', 'wafer', 'cracker', 'oreo', 'parle', 'britannia', 'hide seek', 'digestive'),
            [
                ("Oats Digestive Biscuits", "Better Bakes", "B", 7.4),
                ("Ragi Cookies", "Millet Kitchen", "A", 8.2),
                ("Whole Wheat Crackers", "Grain Good", "B", 7.5)
            ]
        ),
        (
            ('chocolate', 'cocoa', 'cacao', 'confectionery', 'candy', 'toffee'),
            [
                ("Dark Chocolate 70% Cocoa", "Better Choice", "B", 7.8),
                ("Dates and Nut Energy Bar", "Whole Food", "A", 8.4),
                ("No Added Sugar Cocoa Bites", "Healthy Treats", "B", 7.2)
            ]
        ),
        (
            ('chips', 'crisps', 'namkeen', 'bhujia', 'kurkure', 'lays', 'extruded-snacks'),
            [
                ("Roasted Makhana", "Snack Smart", "A", 8.8),
                ("Baked Millet Puffs", "Whole Grain", "B", 7.6),
                ("Roasted Chana Mix", "Protein Pantry", "A", 8.3)
            ]
        ),
        (
            ('cereal', 'corn flakes', 'muesli', 'muesli', 'granola', 'breakfast', 'oats', 'oat'),
            [
                ("No Added Sugar Muesli", "True Elements", "A", 8.6),
                ("Ragi Flakes", "Soulfull", "A", 8.0),
                ("High Fiber Oats", "Quaker", "B", 7.7)
            ]
        ),
        (
            ('beverage', 'drink', 'juice', 'soda', 'cola', 'soft drink', 'water', 'lassi'),
            [
                ("Unsweetened Lemon Water", "Fresh Choice", "A", 9.0),
                ("Coconut Water", "Natural Hydrate", "A", 8.5),
                ("No Added Sugar Juice", "Fruit First", "B", 7.4)
            ]
        ),
        (
            ('milk', 'yogurt', 'curd', 'dairy', 'lassi', 'kefir'),
            [
                ("Plain Greek Yogurt", "Protein Dairy", "A", 8.4),
                ("Unsweetened Curd", "Fresh Dairy", "A", 8.1),
                ("Low Sugar Lassi", "Better Dairy", "B", 7.2)
            ]
        ),
        (
            ('sauce', 'ketchup', 'spread', 'jam', 'mayonnaise', 'mayo', 'marmalade'),
            [
                ("Organic Tomato Sauce", "Organic Brand", "A", 9.0),
                ("Natural Ketchup", "Healthy Choice", "B", 8.0),
                ("No Added Sugar Spread", "Clean Pantry", "B", 7.6)
            ]
        ),
        (
            ('bar', 'snack bar', 'energy bar', 'sweet', 'chikki', 'bar'),
            [
                ("Dates and Nut Energy Bar", "Whole Food", "A", 8.4),
                ("No Added Sugar Fruit Bar", "Fruit First", "B", 7.6),
                ("Roasted Peanut Chikki", "Simple Snacks", "B", 7.3)
            ]
        )
    ]

    # Pick the most specific group that matches the context.
    selected = None
    for keywords, items in fallback_groups:
        if context_contains(context_text, keywords):
            selected = items
            break

    # If nothing matched, fall back to category-only defaults.
    if selected is None:
        selected = [
            ("Organic Whole Food Alternative", "Barcodeify Picks", "A", 8.5),
            ("Low Sugar Better Choice", "Barcodeify Picks", "B", 7.8),
            ("High Fiber Everyday Option", "Barcodeify Picks", "B", 7.2)
        ]

    # Apply a small personalization tweak based on scanned ingredients.
    # (Changes health_score ordering / summary, while still keeping fallback brands.)
    personalized = []
    ingredients_lower = (product_context or '').lower()
    prefers_protein = any(k in ingredients_lower for k in ['protein', 'whey', 'soy', 'paneer', 'curd', 'greek yogurt'])
    contains_sugar = any(k in ingredients_lower for k in ['sugar', 'glucose', 'dextrose', 'syrup', 'honey', 'molasses'])

    for idx, (name, brand, grade, score) in enumerate(selected):
        score_adj = score
        if prefers_protein and any(k in name.lower() for k in ['yogurt', 'protein']):
            score_adj = min(10, score + 0.6)
        if contains_sugar and any(k in name.lower() for k in ['unsweetened', 'no added sugar']):
            score_adj = min(10, score + 0.7)

        ingredients = get_fallback_ingredients(name, category_query)
        personalized.append({
            "barcode": "",
            "name": name,
            "brand": brand,
            "image": get_fallback_image(name, category_query),
            "category": simplify_category(category_query),
            "quantity": "Per 100g",
            "ingredients": ingredients,
            "nutrients": get_fallback_nutrients(name, category_query),
            "nutrition_grade": grade,
            "health_score": score_adj,
            "status": analyzer.get_status(score_adj),
            "summary": get_alternative_summary(score_adj, ingredients)
        })

    return personalized


def merge_with_fallbacks(alternatives, category_query, product_context='', limit=8):
    """Top up weak live search results with category-aware better picks."""
    fallbacks = get_fallback_alternatives(category_query, product_context)
    merged = []
    seen_names = set()

    live_has_strong_option = any(
        item.get("nutrition_grade", "").lower() in {"a", "b"} or item.get("health_score", 0) >= 7
        for item in alternatives
    )

    source_items = alternatives if live_has_strong_option and len(alternatives) >= 3 else fallbacks + alternatives

    for item in source_items:
        name_key = item.get("name", "").strip().lower()
        if not name_key or name_key in seen_names:
            continue

        seen_names.add(name_key)
        merged.append(item)

        if len(merged) == limit:
            break

    return merged

@app.route('/health', methods=['GET'])
def health_check():
    return jsonify({"status": "healthy", "service": "Barcodeify API"})

@app.route('/product/<barcode>', methods=['GET'])
def get_product(barcode):
    """Fetch product data from OpenFoodFacts and analyze"""
    try:
        product = fetch_openfoodfacts_product(barcode)

        if not product:
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
            "ingredients": extract_ingredients_text(product),
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
        ingredient_names = analyzer.parse_ingredients(product_info['ingredients'])
        ingredient_details = analyzer.classify_ingredient_details(ingredient_names)
        ingredient_analysis = analyzer.classify_ingredients(product_info['ingredients'])
        warnings = analyzer.detect_warnings(product_info['ingredients'])
        health_score = analyzer.calculate_health_score(
            product_info['nutrition_grade'], 
            ingredient_analysis
        )
        status = analyzer.get_status(health_score)
        
        analysis = {
            "ingredient_analysis": ingredient_analysis,
            "ingredient_details": ingredient_details,
            "warnings": warnings,
            "health_score": health_score,
            "status": status
        }
        
        # Save to Firebase
        save_scan_history(
            barcode,
            product_info['name'],
            health_score,
            status,
            product_payload={
                'brand': product_info.get('brand'),
                'category': product_info.get('category'),
                'image': product_info.get('image'),
                'nutrition_grade': product_info.get('nutrition_grade'),
                'ingredients': product_info.get('ingredients'),
            }
        )

        
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
                "barcode": data.get('barcode'),
                "name": data.get('name'),
                "brand": data.get('brand'),
                "category": data.get('category'),
                "image": data.get('image'),
                "nutrition_grade": data.get('nutrition_grade'),
                "ingredients": data.get('ingredients'),
                "score": data.get('score'),
                "status": data.get('status'),
                "timestamp": data['timestamp']
            })

        
        return jsonify({"history": history})
        
    except Exception as e:
        print(f"History error: {str(e)}")
        return jsonify({"history": []})

def save_scan_history(barcode, name, score, status, product_payload=None):
    """Save scan to Firebase Firestore.

    product_payload can include extra fields for showing recently scanned items.
    """
    try:
        payload = {
            'barcode': barcode,
            'name': name,
            'score': score,
            'status': status,
            'timestamp': firestore.SERVER_TIMESTAMP,
        }

        if isinstance(product_payload, dict):
            payload.update({
                'brand': product_payload.get('brand'),
                'category': product_payload.get('category'),
                'image': product_payload.get('image'),
                'nutrition_grade': product_payload.get('nutrition_grade'),
                'ingredients': product_payload.get('ingredients'),
            })

        db.collection('scans').add(payload)
    except Exception as e:
        print(f"Failed to save history: {str(e)}")


@app.route('/chat', methods=['POST'])
def chat():
    """Chatbot endpoint implementing the requested algorithm.

    Input JSON:
      {"message": "...", "context": {"product_payload": {...}, "analysis": {...}}}

    Context is optional; without it we fallback to a generic prompt.
    """

    try:
        payload = request.get_json(force=True) or {}
        user_message = payload.get('message', '')
        context = payload.get('context') or {}

        # Build a safe prompt (server-side)
        product_payload = context.get('product_payload') if isinstance(context, dict) else None
        analysis = context.get('analysis') if isinstance(context, dict) else None

        system_hint = (
            "You are Barcodeify+ nutrition assistant. "
            "Respond in simplified English. "
            "If product context is provided, use it. "
            "Keep answers concise but helpful."
        )

        # Decide cloud vs local
        hf_key = os.environ.get('VITE_HF_API_KEY')  # provided for local dev

        def build_cloud_prompt() -> str:
            parts = [system_hint]
            if isinstance(product_payload, dict):
                parts.append(f"Product: {product_payload}")
            if isinstance(analysis, dict):
                parts.append(f"Analysis: {analysis}")
            parts.append(f"User message: {user_message}")
            return "\n\n".join(parts)

        # Algorithm: if key exists -> try cloud with timeout; else -> local engine
        if hf_key:
            prompt = build_cloud_prompt()
            try:
                # llama3_cloud_chat already uses ~8s timeout_s by default
                response_text = llama3_cloud_chat(prompt, hf_key, timeout_s=8)
                if response_text:
                    return jsonify({"success": True, "reply": response_text})
            except Exception:
                # fall through to local engine
                pass

        reply = get_local_response(user_message, {
            "product_payload": product_payload,
            "analysis": analysis
        })
        return jsonify({"success": True, "reply": reply})

    except Exception as e:
        return jsonify({"success": False, "error": str(e), "reply": "Sorry, something went wrong."}), 500


@app.route('/alternatives/<category>/<exclude_barcode>', methods=['GET'])
def get_alternatives(category, exclude_barcode):


    """Find better products from the same or nearest available category."""
    try:
        scanned_product = fetch_openfoodfacts_product(exclude_barcode) if exclude_barcode else {}
        scanned_score = get_health_score_for_product(scanned_product) if scanned_product else 0
        category_query = choose_specific_category_tag(scanned_product, category)
        product_context = build_alternative_context(scanned_product, category)

        if not category_query:
            return jsonify({"alternatives": []})

        search_params = {
            "action": "process",
            "json": 1,
            "page_size": 24,
            "fields": PRODUCT_FIELDS,
            "sort_by": "nutrition_score"
        }

        if category_query.startswith('en:'):
            search_params.update({
                "tagtype_0": "categories",
                "tag_contains_0": "contains",
                "tag_0": category_query
            })
        else:
            search_params["search_terms"] = category_query

        response = requests.get(
            OPENFOODFACTS_SEARCH_API,
            params=search_params,
            headers=OPENFOODFACTS_HEADERS,
            timeout=10
        )
        response.raise_for_status()

        products = response.json().get('products', [])
        alternatives = []
        seen_barcodes = {str(exclude_barcode)}

        for product in products:
            barcode = str(product.get('code', ''))
            name = product.get('product_name', '').strip()

            if not barcode or barcode in seen_barcodes or not name:
                continue

            alternative = normalize_alternative(product)
            grade = alternative["nutrition_grade"].lower()

            if alternative["health_score"] < scanned_score and grade not in {'a', 'b'}:
                continue

            seen_barcodes.add(barcode)
            alternatives.append(alternative)

            if len(alternatives) == 8:
                break

        alternatives = merge_with_fallbacks(alternatives, category_query, product_context, limit=8)

        alternatives.sort(key=lambda item: item["health_score"], reverse=True)
        return jsonify({
            "category": category_query,
            "alternatives": alternatives
        })

    except requests.exceptions.RequestException as e:
        print(f"Alternatives API error: {str(e)}")
        product_context = ' '.join([
            category,
            request.args.get('name', ''),
            request.args.get('brand', ''),
            request.args.get('ingredients', '')
        ])
        return jsonify({"alternatives": get_fallback_alternatives(category, product_context)}), 200
    except Exception as e:
        print(f"Alternatives error: {str(e)}")
        print(traceback.format_exc())
        product_context = ' '.join([
            category,
            request.args.get('name', ''),
            request.args.get('brand', ''),
            request.args.get('ingredients', '')
        ])
        return jsonify({"alternatives": get_fallback_alternatives(category, product_context)}), 200

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    debug = os.environ.get('FLASK_DEBUG', '0') == '1'
    app.run(host='0.0.0.0', port=port, debug=debug, use_reloader=False)
