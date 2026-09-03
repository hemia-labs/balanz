FROM node:22.22.0-bookworm-slim@sha256:dd9d21971ec4395903fa6143c2b9267d048ae01ca6d3ea96f16cb30df6187d94

RUN apt-get update \
    && apt-get install --yes --no-install-recommends \
      iproute2=6.1.0-3 \
      procps=2:4.0.2-3 \
      sudo=1.9.13p3-1+deb12u4 \
    && test "$(stat -c '%U:%G:%a' /usr/bin/sudo)" = root:root:4755 \
    && sudo --version | grep -Fq 'Sudo version 1.9.13p3' \
    && ip -Version | grep -Fq 'iproute2-6.1.0' \
    && pgrep --version | grep -Fq 'procps-ng 4.0.2' \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace
