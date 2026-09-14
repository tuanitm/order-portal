"""
Generate encrypted SMTP password for .env file.
Usage: python gen_smtp_pass.py
"""
from cryptography.fernet import Fernet
import os

key_path = os.path.join(os.path.dirname(__file__), 'scripts', '.encryption_key')
key = open(key_path, 'rb').read()
f = Fernet(key)

password = input("Enter SMTP authorization code: ").strip()
if not password:
    print("No password entered.")
    exit(1)

encrypted = f.encrypt(password.encode()).decode()
print(f"\nUpdate your .env file with:")
print(f"SMTP_PASS=FERNET:{encrypted}")

# Quick verify
decrypted = f.decrypt(encrypted.encode()).decode()
print(f"\nVerification - decrypted length: {len(decrypted)} chars ✓")
