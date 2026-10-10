import os

main_py_path = os.path.join(os.path.dirname(__file__), "main.py")
with open(main_py_path, "r") as f:
    content = f.read()

replacement = """
from fastapi.exceptions import RequestValidationError
from validation_handler import custom_validation_exception_handler

def create_app(store=None, providers=None, real_engine=None):
"""

content = content.replace("def create_app(store=None, providers=None, real_engine=None):", replacement)

replacement_app = """
    app = FastAPI(title="RAHAT AI", version="0.1.0")
    app.add_exception_handler(RequestValidationError, custom_validation_exception_handler)
"""

content = content.replace("    app = FastAPI(title=\"RAHAT AI\", version=\"0.1.0\")", replacement_app)

with open(main_py_path, "w") as f:
    f.write(content)
print("Patched main.py")
