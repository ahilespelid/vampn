"""Живой поток уведомлений (SSE) для открытого приложения.

Уведомления создают не только эндпоинты API, но и внешние процессы, которые пишут в базу напрямую
(синхронизация пользователей, сторож vampn), поэтому поток не опирается на очередь событий внутри API.
Раз в несколько секунд он сравнивает «подпись» уведомлений пользователя (см. MySQLStore.notifications_signature)
и при любом изменении присылает событие `changed`; приложение в ответ запрашивает GET /v1/notifications.

События:
  retry: 3000        - через сколько миллисекунд клиенту переподключаться
  ready              - поток открыт
  changed            - уведомления появились или поменяли статус
  : ping             - комментарий, чтобы прокси и телефон не считали соединение мёртвым
  unauthorized       - сессия закончилась или доступ отозван, поток закрывается
  bye                - плановое закрытие по времени, клиент переподключается
  error              - сбой на сервере, клиент переподключается с задержкой
"""
import asyncio
import json
import logging
import time

from starlette.concurrency import run_in_threadpool

log = logging.getLogger("vampn_api.stream")


def sse(event: str, data=None) -> str:
    return "event: %s\ndata: %s\n\n" % (event, json.dumps(data or {}, ensure_ascii=False))


async def notification_stream(signature, still_valid, *, poll=3.0, heartbeat=15.0, recheck=30.0, max_seconds=1800.0,
                              sleep=asyncio.sleep, clock=time.monotonic):
    """Асинхронный генератор SSE-кадров. `signature()` и `still_valid()` блокирующие, их вызывают в потоке."""
    yield "retry: 3000\n\n"
    try:
        last = await run_in_threadpool(signature)
    except Exception:  # сбой базы: пусть клиент переподключится
        log.exception("поток уведомлений: не получена подпись")
        yield sse("error")
        return
    yield sse("ready")

    started = last_sent = last_check = clock()
    while True:
        await sleep(poll)
        now = clock()
        if now - started >= max_seconds:
            yield sse("bye")
            return
        if now - last_check >= recheck:
            last_check = now
            try:
                valid = await run_in_threadpool(still_valid)
            except Exception:
                log.exception("поток уведомлений: не проверена сессия")
                yield sse("error")
                return
            if not valid:
                yield sse("unauthorized")
                return
        try:
            current = await run_in_threadpool(signature)
        except Exception:
            log.exception("поток уведомлений: не получена подпись")
            yield sse("error")
            return
        if current != last:
            last, last_sent = current, now
            yield sse("changed")
        elif now - last_sent >= heartbeat:
            last_sent = now
            yield ": ping\n\n"
