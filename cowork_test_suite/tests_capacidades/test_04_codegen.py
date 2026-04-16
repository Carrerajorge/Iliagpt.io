"""
Pilar 4 — Generación y ejecución de código.

Para cada operación aritmética generamos una función Python, verificamos
que su sintaxis sea válida, la compilamos, la ejecutamos y comprobamos el
resultado. Añadimos también checks de evaluación puntual para una librería
matemática generada.

7 ops × 100 valores = 700 tests de aritmética
+ 100 tests de plantilla de funciones con nombres/args aleatorios
+ 50 tests de fizzbuzz generado
= 850 tests.
"""
import math
import operator

import pytest

from cowork_lib import generate_python_function, python_syntax_ok, run_python


OPS = [
    ("add", "a + b", operator.add),
    ("sub", "a - b", operator.sub),
    ("mul", "a * b", operator.mul),
    ("intdiv", "a // max(b, 1)", lambda a, b: a // max(b, 1)),
    ("mod", "a % max(b, 1)", lambda a, b: a % max(b, 1)),
    ("power", "a ** (b % 5)", lambda a, b: a ** (b % 5)),
    ("xor", "a ^ b", operator.xor),
]
PAIRS = [(i, (i * 7 + 3) % 19) for i in range(100)]


@pytest.mark.parametrize("name,body_expr,ref", OPS)
@pytest.mark.parametrize("a,b", PAIRS)
def test_generated_arithmetic(name, body_expr, ref, a, b):
    code = generate_python_function(
        name=f"op_{name}",
        args=["a", "b"],
        body=f"return {body_expr}",
    )
    assert python_syntax_ok(code), code
    ns = run_python(code)
    fn = ns[f"op_{name}"]
    assert fn(a, b) == ref(a, b), f"{name}({a},{b})"


NAMES = [f"func_{i:03d}" for i in range(100)]


@pytest.mark.parametrize("fname", NAMES)
def test_generated_template_returns_constant(fname):
    code = generate_python_function(
        name=fname,
        args=[],
        body="return 42",
        doc=f"Returns 42 for {fname}",
    )
    assert python_syntax_ok(code)
    ns = run_python(code)
    assert ns[fname]() == 42


FIZZBUZZ_INPUTS = list(range(1, 51))


@pytest.mark.parametrize("n", FIZZBUZZ_INPUTS)
def test_generated_fizzbuzz(n):
    code = generate_python_function(
        name="fizzbuzz",
        args=["n"],
        body=(
            "if n % 15 == 0: return 'FizzBuzz'\n    "
            "if n % 3 == 0: return 'Fizz'\n    "
            "if n % 5 == 0: return 'Buzz'\n    "
            "return str(n)"
        ),
    )
    assert python_syntax_ok(code)
    ns = run_python(code)
    fz = ns["fizzbuzz"]
    expected = (
        "FizzBuzz" if n % 15 == 0
        else "Fizz" if n % 3 == 0
        else "Buzz" if n % 5 == 0
        else str(n)
    )
    assert fz(n) == expected
