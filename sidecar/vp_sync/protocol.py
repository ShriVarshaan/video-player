"""JSON-lines server: one request per stdin line, one reply per stdout line.

Logs go to stderr only; stdout carries nothing but protocol lines.
"""

import json
import sys
import threading
import traceback
from typing import Any, Callable, Optional, TextIO

Progress = Callable[[str, Optional[float]], None]
Job = Callable[[dict, Progress, threading.Event], dict]


class SyncError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


class _Running:
    def __init__(self, req_id: Any):
        self.id = req_id
        self.cancelled = threading.Event()
        self.thread: Optional[threading.Thread] = None


class Server:
    def __init__(self, run_job: Job, out: TextIO):
        self._run_job = run_job
        self._out = out
        self._write_lock = threading.Lock()
        self._state_lock = threading.Lock()
        self._running: Optional[_Running] = None
        # A cancelled job still finishing; the next job waits for it.
        self._abandoned: Optional[threading.Thread] = None

    def _send(self, obj: dict) -> None:
        with self._write_lock:
            self._out.write(json.dumps(obj, ensure_ascii=False) + "\n")
            self._out.flush()

    def _error(self, req_id: Any, code: str, message: str) -> None:
        self._send({"id": req_id, "error": {"code": code, "message": message}})

    def handle_line(self, line: str) -> None:
        if not line.strip():
            return
        try:
            req = json.loads(line)
            if not isinstance(req, dict):
                raise ValueError("not an object")
        except ValueError as e:
            self._error(None, "INTERNAL", f"bad request: {e}")
            return
        req_id = req.get("id")
        method = req.get("method")
        params = req.get("params") or {}
        if method == "ping":
            self._send({"id": req_id, "result": "pong"})
        elif method == "sync":
            self._start(req_id, params)
        elif method == "cancel":
            self._cancel(params.get("target"))
        else:
            self._error(req_id, "INTERNAL", f"unknown method: {method}")

    def _start(self, req_id: Any, params: dict) -> None:
        with self._state_lock:
            if self._running is not None:
                self._error(req_id, "BUSY", "a sync is already running")
                return
            job = _Running(req_id)
            self._running = job
            before = self._abandoned
            job.thread = threading.Thread(target=self._work, args=(job, params, before), daemon=True)
            job.thread.start()

    def _work(self, job: _Running, params: dict, before: Optional[threading.Thread]) -> None:
        if before is not None:
            before.join()

        def progress(stage: str, pct: Optional[float]) -> None:
            if not job.cancelled.is_set():
                self._send({"id": job.id, "event": "progress", "stage": stage, "pct": pct})

        reply: Optional[dict] = None
        try:
            if not job.cancelled.is_set():
                reply = {"id": job.id, "result": self._run_job(params, progress, job.cancelled)}
        except SyncError as e:
            reply = {"id": job.id, "error": {"code": e.code, "message": e.message}}
        except Exception as e:  # noqa: BLE001 - every failure becomes a reply
            traceback.print_exc(file=sys.stderr)
            reply = {"id": job.id, "error": {"code": "INTERNAL", "message": str(e) or type(e).__name__}}
        with self._state_lock:
            if self._running is job:
                self._running = None
            if self._abandoned is threading.current_thread():
                self._abandoned = None
            if job.cancelled.is_set():
                return  # CANCELLED was already sent
            if reply is not None:
                self._send(reply)

    def _cancel(self, target: Any) -> None:
        with self._state_lock:
            job = self._running
            if job is None or job.id != target:
                return
            job.cancelled.set()
            self._running = None
            self._abandoned = job.thread
            self._error(job.id, "CANCELLED", "cancelled")


    def finish(self) -> None:
        """At end of input: let a running job reply before the process exits."""
        with self._state_lock:
            job = self._running
        if job is not None and job.thread is not None:
            job.thread.join()


def serve(run_job: Job, inp: TextIO, out: TextIO) -> None:
    server = Server(run_job, out)
    for line in inp:
        server.handle_line(line)
    server.finish()
