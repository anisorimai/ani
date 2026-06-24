import os
from dotenv import load_dotenv
from pymongo import MongoClient
import requests

load_dotenv()

# 1. Mongo setup
client = MongoClient(os.getenv("MONGO_URI"))
db = client[os.getenv("MONGO_DB_NAME")]
col = db["test_chunks"]

# 2. Get embedding
text = "flame photometer calibration procedure"

r = requests.post(
    "https://api.mistral.ai/v1/embeddings",
    headers={"Authorization": f"Bearer {os.getenv('EMBEDDING_API_KEY')}"},
    json={"model": "mistral-embed", "input": text}
)

embedding = r.json()["data"][0]["embedding"]

# 3. Insert into Mongo
doc = {
    "text": text,
    "embedding": embedding
}

inserted = col.insert_one(doc)

# 4. Retrieve
retrieved = col.find_one({"_id": inserted.inserted_id})

print("Inserted ID:", inserted.inserted_id)
print("Retrieved text:", retrieved["text"])
print("Embedding length:", len(retrieved["embedding"]))
