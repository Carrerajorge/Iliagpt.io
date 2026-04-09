
import socket
import urllib.request

try:
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.settimeout(2)
    result = sock.connect_ex(('8.8.8.8', 53))
    if result == 0:
        print("NETWORK_ALLOWED")
    else:
        print("NETWORK_BLOCKED")
    sock.close()
except Exception as e:
    print(f"NETWORK_ERROR: {e}")

try:
    response = urllib.request.urlopen('https://httpbin.org/get', timeout=2)
    print("HTTP_ALLOWED")
except Exception as e:
    print(f"HTTP_BLOCKED: {e}")
