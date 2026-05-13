import urllib.request, json
try:
    r = urllib.request.urlopen('http://127.0.0.1:5000/product/3017620422003')
    data = json.loads(r.read().decode())
    print('Backend response:', data.keys())
    if 'product' in data:
        print('Product found:', data['product']['name'])
        print('Category:', data['product'].get('category', 'N/A'))
        print('Barcode:', data['product'].get('barcode', 'N/A'))
except Exception as e:
    print('Error:', e)