#!/bin/bash
# Navigate to the backend directory
cd backend
# Activate the virtual environment
source venv/bin/activate
# Run the FastAPI application
python3 -m uvicorn main:app --reload --host 0.0.0.0 --port 8000
