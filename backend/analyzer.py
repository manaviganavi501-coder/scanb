import json
import os
import re
from collections import Counter

class IngredientAnalyzer:
    def __init__(self):
        data_path = os.path.join(os.path.dirname(__file__), 'data', 'harmful_ingredients.json')
        with open(data_path, 'r', encoding='utf-8') as f:
            self.harmful_data = json.load(f)
    
    def classify_ingredients(self, ingredients_text):
        """Classify ingredients into safe/moderate/harmful categories"""
        ingredients = self.parse_ingredients(ingredients_text)
        if not ingredients:
            return {"safe": 0, "moderate": 0, "harmful": 0}

        ingredient_details = self.classify_ingredient_details(ingredients)
        return {
            "safe": len(ingredient_details["safe"]),
            "moderate": len(ingredient_details["moderate"]),
            "harmful": len(ingredient_details["harmful"])
        }

    def parse_ingredients(self, ingredients_text):
        """Split ingredient text from labels into readable ingredient names."""
        if not ingredients_text:
            return []

        cleaned = re.sub(r'[_*]', ' ', str(ingredients_text))
        cleaned = re.sub(r'\s+', ' ', cleaned).strip()
        parts = re.split(r'[,;•]|\.(?=\s+[A-Z])|\n+', cleaned)

        return [
            re.sub(r'\s+', ' ', part).strip(' :-')
            for part in parts
            if re.sub(r'\s+', ' ', part).strip(' :-')
        ]

    def classify_ingredient_details(self, ingredients):
        """Return ingredient names grouped by safety class."""
        harmful_list = self.harmful_data['harmful']
        warning_list = self.harmful_data['warnings']
        sugar_list = self.harmful_data.get('sugar_keywords', [])

        details = {"safe": [], "moderate": [], "harmful": []}
        for ingredient in ingredients:
            lower = ingredient.lower()
            has_palm_oil = 'palm' in lower and 'oil' in lower
            if any(harmful in lower for harmful in harmful_list) or has_palm_oil:
                details["harmful"].append(ingredient)
            elif any(warning in lower for warning in warning_list) or any(sugar in lower for sugar in sugar_list):
                details["moderate"].append(ingredient)
            else:
                details["safe"].append(ingredient)

        return details
    
    def detect_warnings(self, ingredients_text):
        """Detect specific warnings like sugar, allergens, etc."""
        if not ingredients_text:
            return []
        
        warnings = []
        text_lower = ingredients_text.lower()
        
        # Sugar detection
        if any(sugar in text_lower for sugar in self.harmful_data['sugar_keywords']):
            warnings.append("High Sugar Content")
        
        # Specific harmful ingredients
        for harmful in self.harmful_data['harmful']:
            if harmful in text_lower:
                warnings.append(f"Contains {harmful.replace(' oil', ' Oil')}")
        
        # Allergens
        for allergen in self.harmful_data['warnings']:
            if allergen in text_lower:
                warnings.append(f"Contains {allergen.title()}")
        
        return warnings[:5]  # Limit to top 5 warnings
    
    def calculate_health_score(self, nutrition_grade, ingredient_analysis):
        """Calculate overall health score (0-10)"""
        grade_scores = {'a': 10, 'b': 8, 'c': 6, 'd': 4, 'e': 2, 'unknown': 5}
        grade_score = grade_scores.get(nutrition_grade.lower(), 5)
        
        # Ingredient safety score (0-10)
        total = sum(ingredient_analysis.values())
        if total == 0:
            ingredient_score = 10
        else:
            safety_ratio = ingredient_analysis['safe'] / total
            ingredient_score = int(safety_ratio * 10)
        
        # Weighted average
        final_score = int((grade_score * 0.6 + ingredient_score * 0.4))
        return max(0, min(10, final_score))
    
    def get_status(self, health_score):
        """Get status based on health score"""
        if health_score >= 8:
            return "Healthy ✅"
        elif health_score >= 5:
            return "Moderate ⚠️"
        else:
            return "Avoid ❌"
