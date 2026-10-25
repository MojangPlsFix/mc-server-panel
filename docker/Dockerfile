# Sandbox for development and end-to-end tests: the built panel plus a fake Minecraft server,
# controlled through tmux exactly like a real deployment without systemd.
# Build the panel first (npm run build); this image only copies dist/.
FROM node:24-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends tmux procps \
  && rm -rf /var/lib/apt/lists/* \
  && useradd --create-home --uid 1001 minecraft \
  && mkdir -p /srv/minecraft \
  && chown minecraft:minecraft /srv/minecraft

COPY dist/ /opt/panel/
COPY tools/fake-server/fake-server.mjs /opt/fake-server/fake-server.mjs
COPY docker/entrypoint.sh /entrypoint.sh

USER minecraft
ENV MC_PANEL_CONFIG=/home/minecraft/config.json
EXPOSE 8080
ENTRYPOINT ["/entrypoint.sh"]
