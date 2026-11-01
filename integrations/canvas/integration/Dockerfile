FROM mazal-image-canvas-base:20261031
WORKDIR /canvas-app
COPY integration/app.py ./canvas_app.py
USER 10001:10001
ENTRYPOINT []
CMD ["/app/.venv/bin/python", "-m", "uvicorn", "canvas_app:app", "--host", "0.0.0.0", "--port", "8081", "--proxy-headers", "--forwarded-allow-ips", "172.22.0.0/16", "--no-access-log"]
