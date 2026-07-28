#!/usr/bin/env python3
"""Generate an Ed25519 keypair for the CheckMeIn kiosk client.

Run once on the Pi. Writes client.key (private) and prints the public key
in hex so you can paste it into the backend's environment config.
"""

import sys
from nacl.signing import SigningKey

def main():
    key = SigningKey.generate()

    # Write private key (seed) to file
    key_path = "client.key"
    with open(key_path, "wb") as f:
        f.write(bytes(key))
    print(f"Private key written to {key_path}")
    print(f"  (keep this file on the Pi, NEVER commit it)")
    print()

    # Print public key for the backend
    pubkey_hex = key.verify_key.encode().hex()
    print(f"Public key (hex): {pubkey_hex}")
    print(f"  → Set this as KIOSK_PUBLIC_KEY in the backend .env")

if __name__ == "__main__":
    main()
