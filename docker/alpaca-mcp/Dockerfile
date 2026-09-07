# Alpaca MCP server (the official alpacahq/alpaca-mcp-server from PyPI),
# served over streamable HTTP for local MCP clients. Replaces the Render
# service `alpaca-mcp-server-paper`. Paper mode is forced in compose.
FROM python:3.12-slim
ARG ALPACA_MCP_VERSION=2.3.1
RUN pip install --no-cache-dir "alpaca-mcp-server==${ALPACA_MCP_VERSION}" \
 && useradd --system --create-home --shell /usr/sbin/nologin mcp
USER mcp
ENV ALPACA_PAPER_TRADE=true
EXPOSE 8000
CMD ["alpaca-mcp-server", "--transport", "streamable-http", "--host", "0.0.0.0", "--port", "8000"]
