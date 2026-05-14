import os
import re
from typing import Dict, Any, Optional, List

from analyzer import IngredientAnalyzer


def _normalize_text(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "")).strip()


def _detect_keywords(message: str) -> Dict[str, bool]:
    m = message.lower()

    # Routes per your flowchart
    return {
        "health_rating": any(k in m for k in ["health", "rating", "score", "good", "bad", "grade"]),
        "ingredients_additives": any(k in m for k in [
            "ingredient", "ingredients", "additive", "additives", "harmful", "unsafe", "e621", "sugar",
            "preservative", "sweetener", "emulsifier", "color", "colour", "stabilizer", "stabiliser"
        ]),
        "nutrition_sugar_calories": any(k in m for k in [
            "nutrition", "sugar", "calorie", "calories", "energy", "carb", "carbohydrate", "protein", "fat",
            "sodium", "salt", "mg", "g"
        ])
    }


def _format_health(message: str, product_payload: Optional[Dict[str, Any]], analysis: Optional[Dict[str, Any]]) -> str:
    if not product_payload and not analysis:
        return "Please scan an item first so I can answer with real product details." 

    name = product_payload.get("name") if isinstance(product_payload, dict) else None
    category = product_payload.get("category") if isinstance(product_payload, dict) else None
    grade = product_payload.get("nutrition_grade") if isinstance(product_payload, dict) else None

    health_score = None
    status = None
    if analysis and isinstance(analysis, dict):
        health_score = analysis.get("health_score")
        status = analysis.get("status")

    if health_score is None and product_payload:
        health_score = product_payload.get("health_score")
        status = product_payload.get("status")

    parts = []
    title = "Health Summary"
    if name:
        title += f" for {name}"
    parts.append(title)
    parts.append("")

    if category:
        parts.append(f"• Category: {category}")

    if grade:
        parts.append(f"• Nutrition Grade: {str(grade).upper()}")

    if health_score is not None:
        try:
            hs = float(health_score)
            parts.append(f"• Health Score: {hs:.0f}/10")
        except Exception:
            parts.append(f"• Health Score: {health_score}/10")

    if status:
        parts.append(f"• Status: {status}")

    parts.append("")
    parts.append("Simplified (why):")

    ingredient_analysis = analysis.get("ingredient_analysis") if analysis and isinstance(analysis, dict) else None
    if isinstance(ingredient_analysis, dict):
        safe = ingredient_analysis.get("safe", 0)
        moderate = ingredient_analysis.get("moderate", 0)
        harmful = ingredient_analysis.get("harmful", 0)
        total = safe + moderate + harmful
        parts.append(f"• Ingredient split: {safe} safe, {moderate} moderate, {harmful} to limit")
        if total > 0:
            safe_pct = (safe / total) * 100
            parts.append(f"• Since safeness is about {safe_pct:.0f}%, your score reflects both label grade and ingredient mix.")
    else:
        parts.append("• The score blends label grade with ingredient safety signals.")

    parts.append("")
    parts.append("Recommendation:")
    if status and isinstance(status, str) and "Healthy" in status:
        parts.append("• This looks like a relatively strong everyday choice.")
    elif status and isinstance(status, str) and "Avoid" in status:
        parts.append("• Better to limit. If you want it, choose smaller portions or less frequent use.")
    else:
        parts.append("• It’s okay occasionally—check ingredients and portion size.")

    return "\n".join(parts)


def _format_ingredients(message: str, product_payload: Optional[Dict[str, Any]], analysis: Optional[Dict[str, Any]]) -> str:
    if not product_payload and not analysis:
        return "Please scan an item first so I can highlight ingredients and potential harmful/additive concerns." 

    name = product_payload.get("name") if isinstance(product_payload, dict) else None
    ingredients_text = product_payload.get("ingredients") if isinstance(product_payload, dict) else None

    ingredient_details = analysis.get("ingredient_details") if analysis and isinstance(analysis, dict) else None
    warnings = analysis.get("warnings") if analysis and isinstance(analysis, dict) else None

    parts: List[str] = []
    parts.append("Ingredient & Additives Insights")
    if name:
        parts.append(f"For: {name}")
    parts.append("")

    if warnings:
        parts.append("Top warnings:")
        for w in warnings[:5]:
            parts.append(f"• {w}")
        parts.append("")

    if isinstance(ingredient_details, dict):
        safe = ingredient_details.get("safe", [])
        moderate = ingredient_details.get("moderate", [])
        harmful = ingredient_details.get("harmful", [])

        def preview(arr, limit=8):
            arr = arr or []
            return ", ".join([str(x) for x in arr[:limit]]) if arr else "None detected"

        parts.append("Safe ingredients (often fine):")
        parts.append(preview(safe))
        parts.append("")

        parts.append("Moderate ingredients (use in balance):")
        parts.append(preview(moderate))
        parts.append("")

        parts.append("Ingredients to limit (if present):")
        parts.append(preview(harmful))
        parts.append("")

    if not ingredient_details and ingredients_text:
        analyzer = IngredientAnalyzer()
        parsed = analyzer.parse_ingredients(ingredients_text)
        details = analyzer.classify_ingredient_details(parsed)
        parts.append("(From label parsing) Ingredients preview:")
        parts.append(f"• Safe: {', '.join(details['safe'][:8]) or 'None'}")
        parts.append(f"• Moderate: {', '.join(details['moderate'][:8]) or 'None'}")
        parts.append(f"• To limit: {', '.join(details['harmful'][:8]) or 'None'}")

    if ingredients_text:
        parts.append("")
        parts.append("Full ingredients (as available):")
        parts.append("\n" + str(ingredients_text)[:1200] + ("…" if len(str(ingredients_text)) > 1200 else ""))

    # Simplified guidance
    parts.append("")
    parts.append("Simple advice:")
    if ingredient_details and isinstance(ingredient_details, dict):
        harmful = ingredient_details.get("harmful", [])
        moderate = ingredient_details.get("moderate", [])
        if harmful:
            parts.append("• If you see ‘to limit’ ingredients, try a similar product with fewer of them.")
        elif moderate:
            parts.append("• If moderate ingredients are present, it’s usually okay—just don’t overdo it.")
        else:
            parts.append("• This looks relatively clean based on ingredient categories.")

    return "\n".join(parts)


def _format_nutrition(message: str, product_payload: Optional[Dict[str, Any]], analysis: Optional[Dict[str, Any]]) -> str:
    if not product_payload and not analysis:
        return "Please scan an item first so I can show nutrition table (per 100g)." 

    nutrients = product_payload.get("nutrients") if isinstance(product_payload, dict) else None
    if not isinstance(nutrients, dict):
        nutrients = {}

    def pick(k, aliases=None):
        aliases = aliases or []
        if k in nutrients and nutrients[k] not in (None, "", "Not available"):
            return nutrients[k]
        for a in aliases:
            if a in nutrients and nutrients[a] not in (None, "", "Not available"):
                return nutrients[a]
        return None

    rows = [
        ("Energy", pick("energy")),
        ("Protein (g)", pick("proteins")),
        ("Carbohydrates (g)", pick("carbohydrates")),
        ("Total Fat (g)", pick("fats")),
        ("Saturated Fat (g)", pick("saturated_fat", ["saturated-fat_100g"])) ,
        ("Sugars (g)", pick("sugars")),
        ("Sodium (mg)", pick("sodium")),
    ]

    parts: List[str] = []
    parts.append("Nutrition (Per 100g) — simplified")
    parts.append("")
    parts.append("| Nutrient | Value |")
    parts.append("|---|---|")
    for label, val in rows:
        parts.append(f"| {label} | {val if val is not None else '—'} |")

    parts.append("")
    parts.append("Tip:")
    parts.append("• If sugars and saturated fat look high for your goal (weight, sugar control, cholesterol), compare alternatives and choose the lower ones.")

    return "\n".join(parts)


def _format_general(message: str, product_payload: Optional[Dict[str, Any]], analysis: Optional[Dict[str, Any]]) -> str:
    name = product_payload.get("name") if isinstance(product_payload, dict) else None
    category = product_payload.get("category") if isinstance(product_payload, dict) else None

    parts = ["Product Overview"]
    if name:
        parts.append(f"For: {name}")
    if category:
        parts.append(f"Category: {category}")

    parts.append("")

    # Provide short heuristic summary
    if analysis and isinstance(analysis, dict):
        hs = analysis.get("health_score")
        status = analysis.get("status")
        if hs is not None:
            parts.append(f"Health score: {hs}/10")
        if status:
            parts.append(f"Status: {status}")

    parts.append("")
    parts.append("Ask me about:")
    parts.append("• health / rating")
    parts.append("• ingredients / additives")
    parts.append("• nutrition / sugar / calories")

    return "\n".join(parts)


def get_local_response(user_message: str, context: Optional[Dict[str, Any]]) -> str:
    product_payload = (context or {}).get("product_payload")
    analysis = (context or {}).get("analysis")

    msg = _normalize_text(user_message).lower()
    if not msg:
        return "Please type a message." 

    keywords = _detect_keywords(msg)

    if keywords["health_rating"]:
        return _format_health(user_message, product_payload, analysis)

    if keywords["ingredients_additives"]:
        return _format_ingredients(user_message, product_payload, analysis)

    if keywords["nutrition_sugar_calories"]:
        return _format_nutrition(user_message, product_payload, analysis)

    return _format_general(user_message, product_payload, analysis)

