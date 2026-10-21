"""Vercel entry point. Vercel's Python runtime looks for a class named `handler` that
subclasses BaseHTTPRequestHandler in this file, and calls it per request - the exact shape
comfix_web_demo.DemoHandler is already written in, so this just re-exports it under that name.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from comfix_web_demo import DemoHandler as handler  # noqa: E402,F401
