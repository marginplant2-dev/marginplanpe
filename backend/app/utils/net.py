"""Real client IP resolution.

All hostnames sit behind Cloudflare (see nginx config), so the peer address is
always a Cloudflare edge IP. Cloudflare puts the true visitor IP in
``CF-Connecting-IP`` — the one header a client CANNOT spoof (Cloudflare
overwrites it). ``X-Forwarded-For``'s first hop is NOT safe: Cloudflare appends
the real IP AFTER any client-supplied XFF, so a client sending its own XFF can
push a fake value into first position. Prefer CF's header, then generic
real-client headers, then XFF, then the peer.
"""

from __future__ import annotations

from fastapi import Request


def client_ip(request: Request) -> str:
    for h in ("cf-connecting-ip", "true-client-ip"):
        v = request.headers.get(h)
        if v and v.strip():
            return v.strip()
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else "0.0.0.0"
