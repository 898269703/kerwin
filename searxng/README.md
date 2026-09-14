# PDF Finder SearXNG service

This directory is the reproducible Railway source for the public-search adapter used by `frontend/lib/web-search.ts`. The image is pinned by digest and the checked-in settings explicitly enable the JSON response format required by the frontend.

The Railway service must define a private, randomly generated `SEARXNG_SECRET`; the runtime environment variable overrides the non-secret placeholder in `settings.yml`. Do not commit or print its value.

Build and verify locally:

```sh
docker build -t pdf-finder-searxng:test .
docker run --rm -p 127.0.0.1:18080:8080 \
  -e SEARXNG_SECRET=local-test-only pdf-finder-searxng:test
curl --get --data-urlencode 'q=电力工程 PDF' \
  --data-urlencode 'format=json' \
  --data-urlencode 'categories=general' \
  http://127.0.0.1:18080/search
```

Deploy from the repository root with the official Railway CLI, selecting the existing production project, environment, and `searxng` service:

```sh
railway up ./searxng --path-as-root --project <project-id> \
  --environment <environment-id> --service <service-id>
```

After deployment, require HTTP 200 with `application/json` from `/search?format=json`, then run a frontend library-miss search and confirm the worker receives authenticated `/v1/search-discovery/jobs` requests.

