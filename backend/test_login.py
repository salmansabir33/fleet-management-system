# test_login.py
import httpx
from tracker_backend.config import settings

TRACCAR_URL = settings.TRACCAR_URL
EMAIL       = settings.TRACCAR_EMAIL
PASSWORD    = settings.TRACCAR_PASSWORD


def test_login():

    print("=" * 50)
    print(f"Testing connection to: {TRACCAR_URL}")
    print(f"Email                : {EMAIL}")
    print("=" * 50)

    with httpx.Client() as client:

        # Test 1: Can we reach the server?
        print("\n🌐 Step 1: Testing server connection...")
        try:
            server = client.get(f"{TRACCAR_URL}/api/server")
            print(f"✅ Server reachable! Status: {server.status_code}")
            print(f"   Response: {server.json()}")
        except Exception as e:
            print(f"❌ Cannot reach server: {e}")
            return

        # Test 2: Can we login?
        print("\n🔐 Step 2: Testing login...")
        try:
            login = client.post(
                f"{TRACCAR_URL}/api/session",
                data={
                    "email": EMAIL,
                    "password": PASSWORD
                }
            )
            print(f"   Status Code: {login.status_code}")

            if login.status_code == 200:
                print("✅ Login successful!")
                print(f"   User: {login.json()}")
                cookies = login.cookies

                # Test 3: Get devices
                print("\n📱 Step 3: Getting devices...")
                devices = client.get(
                    f"{TRACCAR_URL}/api/devices",
                    cookies=cookies
                )
                print(f"✅ Devices: {devices.json()}")

            else:
                print(f"❌ Login failed!")
                print(f"   Response: {login.text}")

        except Exception as e:
            print(f"❌ Login error: {e}")


if __name__ == "__main__":
    test_login()