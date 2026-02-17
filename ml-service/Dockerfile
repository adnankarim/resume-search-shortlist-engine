FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .

# Install system dependencies including ca-certificates
RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*

# Install torch first for better caching with trusted host flags
RUN pip install --no-cache-dir torch>=2.0.0 --index-url https://download.pytorch.org/whl/cpu --trusted-host download.pytorch.org --trusted-host pypi.org --trusted-host files.pythonhosted.org
# CPU version is much smaller and sufficient for this demo/MVP unless GPU is available
# If GPU needed, remove --index-url ...

RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
