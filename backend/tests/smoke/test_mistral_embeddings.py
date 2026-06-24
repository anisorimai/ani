import os
import requests
from dotenv import load_dotenv

load_dotenv()

api_key = os.getenv("EMBEDDING_API_KEY")

print("API KEY LOADED:", bool(api_key))

try:
    r = requests.post(
        "https://api.mistral.ai/v1/embeddings",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json"
        },
        json={
            "model": "mistral-embed",
            "input": "flame photometer test"
        },
        timeout=30
    )

    print("STATUS:", r.status_code)
    data = r.json()
    print(data)
    print("RESPONSE:", r.text)
    print(len(r.json()["data"][0]["embedding"]))
    

except Exception as e:
    print("REQUEST FAILED:", str(e))