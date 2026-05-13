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
        if not ingredients_text:
            return {"safe": 0, "moderate": 0, "harmful": 0}
        
        ingredients = [ing.lower().strip() for ing in ingredients_text.split(',')]
        harmful_list = self.harmful_data['harmful']
        warning_list = self.harmful_data['warnings']
        
        harmful_count = sum(1 for ing in ingredients if any(h in ing for h in harmful_list))
        warning_count = sum(1 for ing in ingredients if any(w in ing for w in warning_list))
        total_ingredients = len(ingredients)
        
        safe = total_ingredients - harmful_count - warning_count
        moderate = warning_count
        
        return {
            "safe": max(0, safe),
            "moderate": moderate,
            "harmful": harmful_count
        }
    
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