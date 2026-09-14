#!/usr/bin/env python3
"""
Encrypt/Decrypt BASE.VN API token for secure storage in config.json.
Uses Fernet symmetric encryption (cryptography library).

Usage:
  python encrypt_token.py encrypt "your_token_here"     # Encrypt a token
  python encrypt_token.py decrypt "encrypted_token"     # Decrypt a token
  python encrypt_token.py setup                         # Interactive setup
"""

import sys
import json
import base64
import os
from pathlib import Path

# Try to import cryptography, install if needed
try:
    from cryptography.fernet import Fernet
except ImportError:
    print("Installing cryptography library...")
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "cryptography", "-q"])
    from cryptography.fernet import Fernet


# Handle Windows console encoding
if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')

SCRIPT_DIR = Path(__file__).parent
# Config is in parent directory, key stays with scripts
CONFIG_FILE = SCRIPT_DIR.parent / "config.json"
KEY_FILE = SCRIPT_DIR / ".encryption_key"


def generate_key():
    """Generate a new Fernet encryption key."""
    return Fernet.generate_key()


def load_key():
    """Load encryption key from file or generate new one."""
    if KEY_FILE.exists():
        with open(KEY_FILE, 'rb') as f:
            return f.read()
    else:
        key = generate_key()
        with open(KEY_FILE, 'wb') as f:
            f.write(key)
        # Set restrictive permissions (Unix only)
        if sys.platform != 'win32':
            os.chmod(KEY_FILE, 0o600)
        print(f"✓ Generated new encryption key: {KEY_FILE}")
        return key


def encrypt_token(token, key):
    """Encrypt a token using Fernet."""
    f = Fernet(key)
    encrypted = f.encrypt(token.encode('utf-8'))
    return encrypted.decode('utf-8')


def decrypt_token(encrypted_token, key):
    """Decrypt a token using Fernet."""
    f = Fernet(key)
    decrypted = f.decrypt(encrypted_token.encode('utf-8'))
    return decrypted.decode('utf-8')


def load_config():
    """Load config.json."""
    if CONFIG_FILE.exists():
        with open(CONFIG_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    return {}


def save_config(config):
    """Save config.json."""
    with open(CONFIG_FILE, 'w', encoding='utf-8') as f:
        json.dump(config, f, indent=2, ensure_ascii=False)
    print(f"✓ Saved config: {CONFIG_FILE}")


def cmd_encrypt(token):
    """Encrypt a token and optionally save to config."""
    key = load_key()
    encrypted = encrypt_token(token, key)
    
    print("\n🔐 ENCRYPTED TOKEN:")
    print("=" * 60)
    print(encrypted)
    print("=" * 60)
    print(f"\n💡 Encryption key stored in: {KEY_FILE}")
    print("⚠️  BACK UP THIS KEY! If lost, you cannot decrypt the token.")
    print("\nOptions:")
    print(f"  1. Copy encrypted token to config.json (base_vn.access_token_v2)")
    print(f"  2. Run: python {__file__} setup")
    
    # Offer to save to config
    config = load_config()
    if 'base_vn' not in config:
        config['base_vn'] = {}
    
    config['base_vn']['access_token_v2'] = encrypted
    config['base_vn']['encrypted'] = True
    
    save = input("\nSave encrypted token to config.json? (y/n): ").strip().lower()
    if save == 'y':
        save_config(config)
        print("✓ Token encrypted and saved!")
    else:
        print("Token not saved. You can manually add it to config.json")
    
    return encrypted


def cmd_decrypt(encrypted_token=None):
    """Decrypt a token from config or provided string."""
    key = load_key()
    
    if encrypted_token:
        token = encrypted_token
    else:
        config = load_config()
        token = config.get('base_vn', {}).get('access_token_v2', '')
    
    if not token:
        print("Error: No encrypted token found")
        sys.exit(1)
    
    try:
        decrypted = decrypt_token(token, key)
        print("\n🔓 DECRYPTED TOKEN:")
        print("=" * 60)
        print(decrypted)
        print("=" * 60)
        return decrypted
    except Exception as e:
        print(f"Error: Failed to decrypt - {e}")
        print("Make sure you're using the correct encryption key")
        sys.exit(1)


def cmd_setup():
    """Interactive setup to encrypt and store a token."""
    print("\n🔐 BASE.VN Token Encryption Setup")
    print("=" * 50)
    print()
    
    # Get token from user
    token = input("Enter your BASE.VN API token: ").strip()
    if not token:
        print("Error: Token cannot be empty")
        sys.exit(1)
    
    # Encrypt and save
    key = load_key()
    encrypted = encrypt_token(token, key)
    
    config = load_config()
    if 'base_vn' not in config:
        config['base_vn'] = {}
    
    config['base_vn']['access_token_v2'] = encrypted
    config['base_vn']['encrypted'] = True
    config['base_vn']['api_url'] = config.get('base_vn', {}).get('api_url', 
        'https://request.base.vn/extapi/v1/request/get')
    
    save_config(config)
    
    print("\n✅ Setup Complete!")
    print(f"  - Token encrypted and saved to: {CONFIG_FILE}")
    print(f"  - Encryption key stored in: {KEY_FILE}")
    print("\n⚠️  IMPORTANT:")
    print("  - Back up .encryption_key file (required for decryption)")
    print("  - Never commit .encryption_key to version control")
    print("  - Add .encryption_key to .gitignore")
    
    # Show .gitignore entry
    gitignore_file = SCRIPT_DIR / ".gitignore"
    gitignore_content = ""
    if gitignore_file.exists():
        with open(gitignore_file, 'r') as f:
            gitignore_content = f.read()
    
    if '.encryption_key' not in gitignore_content:
        print(f"\n💡 Add this to .gitignore:")
        print("  .encryption_key")
        print("  config.json  # (optional, if you don't want to commit config)")


def cmd_verify():
    """Verify that encryption/decryption works."""
    key = load_key()
    config = load_config()
    
    encrypted = config.get('base_vn', {}).get('access_token_v2', '')
    is_encrypted = config.get('base_vn', {}).get('encrypted', False)
    
    print("\n🔍 Verification Status:")
    print("=" * 50)
    print(f"Config file: {CONFIG_FILE.exists()}")
    print(f"Key file: {KEY_FILE.exists()}")
    print(f"Token encrypted: {is_encrypted}")
    print(f"Has encrypted token: {bool(encrypted)}")
    
    if encrypted and is_encrypted:
        try:
            decrypted = decrypt_token(encrypted, key)
            # Show partial token for verification
            preview = decrypted[:10] + "..." + decrypted[-10:] if len(decrypted) > 20 else "***"
            print(f"Decryption test: ✓ (token preview: {preview})")
        except Exception as e:
            print(f"Decryption test: ✗ ({e})")
    else:
        print("No encrypted token to verify")


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        print("\nCommands:")
        print("  encrypt <token>   - Encrypt a token")
        print("  decrypt [token]   - Decrypt token (from config if not provided)")
        print("  setup             - Interactive setup")
        print("  verify            - Verify encryption setup")
        sys.exit(1)
    
    command = sys.argv[1].lower()
    
    if command == 'encrypt':
        if len(sys.argv) < 3:
            print("Usage: python encrypt_token.py encrypt <your_token>")
            sys.exit(1)
        cmd_encrypt(sys.argv[2])
    
    elif command == 'decrypt':
        encrypted = sys.argv[2] if len(sys.argv) > 2 else None
        cmd_decrypt(encrypted)
    
    elif command == 'setup':
        cmd_setup()
    
    elif command == 'verify':
        cmd_verify()
    
    else:
        print(f"Unknown command: {command}")
        sys.exit(1)


if __name__ == '__main__':
    main()
