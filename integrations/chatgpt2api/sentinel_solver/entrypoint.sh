#!/bin/sh
set -eu

# Browser and OS libraries are installed while building the versioned image.
exec python app.py
