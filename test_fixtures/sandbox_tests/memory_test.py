
import sys
data = []
try:
    for i in range(1000):
        data.append("x" * (10 * 1024 * 1024))  # 10MB chunks
except MemoryError:
    print("MEMORY_LIMIT_ENFORCED")
    sys.exit(0)
print(f"MEMORY_USED: {len(data) * 10}MB")
