# Image name: vampn-agent
# docker build -t vampn-agent .
# docker run --name vampn-agent --rm -p 8000:8000 ...
FROM python:3.12-alpine

RUN apk add --no-cache openssh-client

WORKDIR /app
COPY vampn_server.py .
EXPOSE 8000

CMD ["python", "-u", "vampn_server.py"]
