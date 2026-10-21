"""Vercel entry point. Vercel's Python runtime statically looks for a top-level class literally
named `handler` that subclasses BaseHTTPRequestHandler in this file (an aliased import doesn't
satisfy that scan), and calls it per request - comfix_web_demo.DemoHandler already has all the
actual request-handling behavior, so this just subclasses it under the expected name.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from comfix_web_demo import DemoHandler  # noqa: E402


class handler(DemoHandler):
    pass
