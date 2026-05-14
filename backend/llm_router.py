import os
import requests
from typing import Dict, Any, Optional


def llama3_cloud_chat(prompt: str, api_key: str, timeout_s: int = 8) -> str:
    """Call HuggingFace router for Meta-Llama-3.

    This is used only when VITE_HF_API_KEY is present (frontend provides env).
    For security you may proxy through your backend later; for now keep it server-side.
    """

    # Common model on HF router
    model = os.environ.get("HF_LLM_MODEL", "meta-llama/Meta-Llama-3-8B-Instruct")

    url = "https://router.huggingface.co/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    payload: Dict[str, Any] = {
        "model": model,
        "messages": [
            {"role": "system", "content": "You are a nutrition assistant for product labels. Provide clear, simplified English advice and be concise."},
            {"role": "user", "content": prompt},
        ],
        "temperature": 0.4,
        "max_tokens": 450,
    }

    resp = requests.post(url, headers=headers, json=payload, timeout=timeout_s)
    resp.raise_for_status()
    data = resp.json()

    # router-compatible
    return (
        data.get("choices", [{}])[0]
        .get("message", {})
        .get("content", "")
        or ""
    )

