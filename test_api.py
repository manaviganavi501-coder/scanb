import requests
import json

response = requests.get('https://world.openfoodfacts.org/api/v0/product/3017620422003.json',
                       headers={'User-Agent': 'Mozilla/5.0'})
data = response.json()
product = data.get('product', {})

print('=== NUTRITION DATA STRUCTURE ===')
if 'nutriments' in product:
    nutr = product['nutriments']
    print('Available nutriments:')
    for k, v in nutr.items():
        if isinstance(v, (int, float)) and not k.endswith('_unit') and not k.endswith('_serving'):
            print(f'  {k}: {v}')

print('\n=== CATEGORY AND ALLERGENS ===')
print(f'Categories: {product.get("categories", "N/A")}')
print(f'Allergens: {product.get("allergens", "N/A")}')
print(f'Serving size: {product.get("serving_size", "N/A")}')

print('\n=== SAMPLE PRODUCT STRUCTURE ===')
print(json.dumps({k: v for k, v in product.items() if k in ['categories', 'allergens', 'serving_size', 'nutriments']}, indent=2)[:1000])