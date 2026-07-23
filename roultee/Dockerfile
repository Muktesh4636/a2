FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt gunicorn

COPY backend/ .

RUN python manage.py migrate --noinput

EXPOSE 8010

CMD ["gunicorn", "config.wsgi:application", "--bind", "0.0.0.0:8010", "--workers", "2", "--timeout", "60"]
