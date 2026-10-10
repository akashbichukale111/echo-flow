import os

api_py_path = os.path.join(os.path.dirname(__file__), "api.py")
with open(api_py_path, "r") as f:
    content = f.read()

content = content.replace("model_config = ConfigDict(extra=\"forbid\", allow_inf_nan=False)", "model_config = ConfigDict(extra=\"forbid\")")

with open(api_py_path, "w") as f:
    f.write(content)
print("Patched api.py")
