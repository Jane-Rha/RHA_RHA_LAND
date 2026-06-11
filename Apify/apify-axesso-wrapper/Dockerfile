FROM apify/actor-python:3.11

COPY --chown=myuser:myuser requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY --chown=myuser:myuser . ./

CMD ["python", "-m", "src.main"]
