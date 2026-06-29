import os
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv()  # THIS is what you were missing

print("MONGO_URI:", os.getenv("MONGO_URI"))
print("DB NAME:", os.getenv("MONGO_DB_NAME"))

client = MongoClient(os.getenv("MONGO_URI"))

db_name = os.getenv("MONGO_DB_NAME")
if not db_name:
    raise ValueError("MONGO_DB_NAME is missing in .env")

db = client[db_name]

print("Connected to DB:", db.name)