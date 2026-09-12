from __future__ import annotations

import asyncio
from dataclasses import dataclass

import jwt


@dataclass(frozen=True)
class VercelOidcConfig:
    team_slug: str
    team_id: str
    project_id: str
    allowed_environments: tuple[str, ...] = ("preview", "production")

    @property
    def issuer(self) -> str:
        return f"https://oidc.vercel.com/{self.team_slug}"

    @property
    def audience(self) -> str:
        return f"https://vercel.com/{self.team_slug}"

    @property
    def jwks_url(self) -> str:
        return f"{self.issuer}/.well-known/jwks"


class VercelOidcVerifier:
    def __init__(self, config: VercelOidcConfig, *, jwks_client=None):
        self.config = config
        self._jwks = jwks_client or jwt.PyJWKClient(config.jwks_url)

    def _verify_sync(self, token: str) -> bool:
        signing_key = self._jwks.get_signing_key_from_jwt(token)
        claims = jwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256"],
            issuer=self.config.issuer,
            audience=self.config.audience,
            options={"require": ["exp", "iat", "iss", "aud", "sub"]},
        )

        if claims.get("owner_id") != self.config.team_id:
            raise jwt.InvalidTokenError("unexpected Vercel owner")
        if claims.get("project_id") != self.config.project_id:
            raise jwt.InvalidTokenError("unexpected Vercel project")

        environment = claims.get("environment")
        if environment not in self.config.allowed_environments:
            raise jwt.InvalidTokenError("unexpected Vercel environment")

        subject = claims.get("sub")
        expected_prefix = f"owner:{self.config.team_slug}:project:"
        expected_suffix = f":environment:{environment}"
        if not isinstance(subject, str) or not subject.startswith(expected_prefix) or not subject.endswith(expected_suffix):
            raise jwt.InvalidTokenError("unexpected Vercel subject")

        return True

    async def __call__(self, token: str) -> bool:
        if not token:
            return False
        try:
            return await asyncio.to_thread(self._verify_sync, token)
        except (jwt.PyJWTError, ValueError, TypeError):
            return False
