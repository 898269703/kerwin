FROM searxng/searxng@sha256:e0e0557627cc3e46cc82d8c23bb3a3a74eb203ae42f73142db555551af336096

COPY --chmod=0444 settings.yml /opt/pdf-finder/settings.yml

ENV SEARXNG_SETTINGS_PATH=/opt/pdf-finder/settings.yml

