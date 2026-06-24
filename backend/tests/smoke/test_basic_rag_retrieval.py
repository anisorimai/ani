import os
import requests
import numpy as np
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv()

# ----------------------------
# Mongo setup
# ----------------------------
client = MongoClient(os.getenv("MONGO_URI"))
db = client[os.getenv("MONGO_DB_NAME")]
col = db["test_chunks"]

# ----------------------------
# embedding function
# ----------------------------
def get_embedding(text):
    r = requests.post(
        "https://api.mistral.ai/v1/embeddings",
        headers={"Authorization": f"Bearer {os.getenv('EMBEDDING_API_KEY')}"},
        json={"model": "mistral-embed", "input": text}
    )
    return r.json()["data"][0]["embedding"]

# ----------------------------
# cosine similarity
# ----------------------------
def cosine(a, b):
    a = np.array(a)
    b = np.array(b)
    return np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b))

# ----------------------------
# STEP 1: seed test data
# ----------------------------
docs = [
    "flame photometer calibration procedure",
    "HPLC validation for impurity testing",
    "clean room gowning protocol manufacturing",
    "sterility assurance quality control checklist"
]

print("\nInserting test chunks...\n")

for d in docs:
    emb = get_embedding(d)
    col.insert_one({
        "text": d,
        "embedding": emb
    })

# ----------------------------
# STEP 2: query
# ----------------------------
query = "how to validate HPLC method"
query_emb = get_embedding(query)

# ----------------------------
# STEP 3: retrieve + rank
# ----------------------------
results = []

for doc in col.find():
    score = cosine(query_emb, doc["embedding"])
    results.append((score, doc["text"]))

results.sort(reverse=True)

print("\nTOP MATCHES:\n")
for score, text in results[:3]:
    print(score, "->", text)