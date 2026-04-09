
blocked_modules = ['os', 'subprocess', 'shutil', 'socket']
results = []

for mod in blocked_modules:
    try:
        exec(f"import {mod}")
        results.append(f"{mod}: ALLOWED")
    except (ImportError, ModuleNotFoundError) as e:
        results.append(f"{mod}: BLOCKED")
    except Exception as e:
        results.append(f"{mod}: ERROR({type(e).__name__})")

for r in results:
    print(r)
