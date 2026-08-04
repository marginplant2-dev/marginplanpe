"""Public payment webhooks — no JWT; each provider verified by its own HMAC.

Mounted at /api/v1 so the path is /api/v1/webhooks/oxapay/{admin_code}. The
{admin_code} selects WHICH admin's merchant key verifies the signature and
whose users get credited — every admin routes to their own oxapay account.
"""

from __future__ import annotations

import json
import logging

from bson import ObjectId
from fastapi import APIRouter, HTTPException, Request

from app.models.transaction import DepositRequest, DepositStatus, TransactionType
from app.services import crypto_config_service, oxapay_service, wallet_service
from app.utils.decimal_utils import to_decimal
from app.utils.time_utils import now_utc

router = APIRouter(prefix="/webhooks", tags=["webhooks"])
logger = logging.getLogger("webhooks")


@router.post("/oxapay/{admin_code}")
async def oxapay_webhook(admin_code: str, request: Request):
    raw = await request.body()
    hmac_header = request.headers.get("HMAC") or request.headers.get("hmac") or ""

    cfg = await crypto_config_service.get_by_owner_code(admin_code)
    key = crypto_config_service.decrypted_oxapay_key(cfg) if cfg else None
    # Fail-closed: no key / bad signature → reject, so a forged webhook can
    # never credit a wallet.
    if not oxapay_service.verify_webhook_signature(key, raw, hmac_header):
        logger.warning("oxapay_webhook_bad_signature code=%s", admin_code)
        raise HTTPException(status_code=403, detail="Invalid signature")

    try:
        payload = json.loads(raw)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON")

    order_id = payload.get("order_id") or payload.get("orderId")
    status = payload.get("status")
    track_id = payload.get("track_id") or payload.get("trackId")
    logger.info("oxapay_webhook code=%s order=%s status=%s", admin_code, order_id, status)

    # Only a fully-'paid' invoice credits. waiting/confirming/expired/failed →
    # nothing to do (idempotent no-op).
    if not order_id or not oxapay_service.is_paid(status):
        return {"status": "ok"}
    try:
        oid = ObjectId(str(order_id))
    except Exception:
        return {"status": "ok"}

    # Atomic claim PENDING→APPROVED (double-credit / replay guard): a repeat
    # webhook finds no PENDING row and no-ops. Same pattern as manual approval.
    now = now_utc()
    claimed = await DepositRequest.get_motor_collection().find_one_and_update(
        {"_id": oid, "status": DepositStatus.PENDING.value, "payment_mode": "CRYPTO"},
        {
            "$set": {
                "status": DepositStatus.APPROVED.value,
                "processed_at": now,
                "updated_at": now,
                "gateway_status": str(status),
                "gateway_ref": str(track_id) if track_id else None,
                "admin_remark": "Auto-credited via oxapay",
            }
        },
    )
    if claimed is None:
        return {"status": "ok"}  # already processed / not a pending crypto row

    try:
        await wallet_service.adjust(
            claimed["user_id"],
            to_decimal(claimed["amount"]),
            transaction_type=TransactionType.DEPOSIT,
            narration=f"Crypto deposit via oxapay ({track_id})",
            reference_type="DEPOSIT",
            reference_id=str(oid),
            actor_id=None,
        )
    except Exception:
        # Credit failed after the claim — revert to PENDING so the deposit
        # isn't lost (shows APPROVED with no money). Re-raise so oxapay retries.
        await DepositRequest.get_motor_collection().update_one(
            {"_id": oid},
            {"$set": {"status": DepositStatus.PENDING.value, "processed_at": None, "updated_at": now_utc()}},
        )
        logger.exception("oxapay_webhook_credit_failed order=%s", order_id)
        raise HTTPException(status_code=500, detail="credit failed")

    logger.info("oxapay_webhook_credited order=%s amount=%s", order_id, claimed.get("amount"))
    return {"status": "ok"}
