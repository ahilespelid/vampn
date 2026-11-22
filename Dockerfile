FROM python:3.12-alpine

RUN apk add --no-cache openssh-client

WORKDIR /app
COPY proxy.py .
EXPOSE 8000

CMD ["python", "-u", "proxy.py"]
